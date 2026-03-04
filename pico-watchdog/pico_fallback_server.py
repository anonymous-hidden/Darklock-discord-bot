"""
pico_fallback_server.py
Darklock Systems — Emergency Offline Web Server
================================================
Raspberry Pi Pico 2 W | MicroPython

Serves a minimal 503 offline page when the Pi 5 heartbeat is lost.
Designed to sit behind Cloudflare origin failover.

Usage in your watchdog loop:
    See bottom of this file for integration example.
"""

import socket
import gc

# ─── Module-level state ───────────────────────────────────────────────────────
_server_sock      = None   # The listening TCP socket
_fallback_active  = False  # True while server is running
_cached_response  = None   # Pre-built HTTP response bytes (built once at start)

# ─── Offline page HTML ────────────────────────────────────────────────────────
# Inline CSS only. No external resources. No JavaScript.
# Full page is well under 5 KB.

_HTML_TEMPLATE = (
    "<!DOCTYPE html>"
    "<html lang='en'>"
    "<head>"
    "<meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Darklock Systems</title>"
    "<style>"
    "*{margin:0;padding:0;box-sizing:border-box}"
    "html,body{min-height:100%;background:#0a0a0f;color:#e2e8f0;"
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
    "display:flex;align-items:center;justify-content:center;padding:1.5rem}"
    ".wrap{text-align:center;width:100%;max-width:540px}"
    ".badge{display:inline-flex;align-items:center;gap:.45rem;"
    "background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);"
    "color:#fca5a5;padding:.3rem .85rem;border-radius:99px;"
    "font-size:.75rem;font-weight:700;letter-spacing:.06em;"
    "text-transform:uppercase;margin-bottom:2rem}"
    ".dot{width:7px;height:7px;border-radius:50%;background:#ef4444;"
    "animation:blink 2s ease-in-out infinite}"
    "@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}"
    "h1{font-size:1.9rem;font-weight:700;color:#f8fafc;"
    "margin-bottom:1rem;line-height:1.25}"
    "p{font-size:.975rem;color:#94a3b8;line-height:1.65;margin-bottom:2rem}"
    ".hb{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);"
    "border-radius:10px;padding:.9rem 1.4rem;margin-bottom:2.5rem}"
    ".hb-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;"
    "color:#475569;margin-bottom:.3rem}"
    ".hb-value{font-size:.875rem;color:#00d4ff;font-weight:500;"
    "font-variant-numeric:tabular-nums}"
    ".footer{font-size:.72rem;color:#334155;line-height:1.5}"
    "</style>"
    "</head>"
    "<body>"
    "<div class='wrap'>"
    "<div class='badge'><span class='dot'></span>Service Disruption</div>"
    "<h1>We Are Currently Offline</h1>"
    "<p>Our infrastructure is temporarily unavailable while our team resolves an "
    "active service disruption. We have been automatically notified and are working "
    "to restore full service as quickly as possible. Thank you for your patience.</p>"
    "<div class='hb'>"
    "<div class='hb-label'>Last Successful Connection</div>"
    "<div class='hb-value'>{heartbeat}</div>"
    "</div>"
    "<div class='footer'>Darklock Systems &mdash; "
    "Service will be restored automatically upon recovery</div>"
    "</div>"
    "</body>"
    "</html>"
)


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _build_response(last_heartbeat):
    """
    Pre-build the full HTTP response bytes once when the server starts.
    Subsequent requests reuse this buffer to avoid repeated allocations.
    """
    # Sanitise: strip any HTML special chars from the timestamp string
    safe_ts = (last_heartbeat or "Unknown") \
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    body = _HTML_TEMPLATE.replace("{heartbeat}", safe_ts).encode("utf-8")

    header = (
        "HTTP/1.0 503 Service Unavailable\r\n"
        "Content-Type: text/html; charset=utf-8\r\n"
        "Content-Length: {length}\r\n"
        "Connection: close\r\n"
        "Cache-Control: no-store, no-cache, must-revalidate\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "\r\n"
    ).format(length=len(body)).encode("utf-8")

    return header + body


def _close_socket(sock):
    """Safely close any socket object, ignoring all errors."""
    if sock is None:
        return
    try:
        sock.close()
    except Exception:
        pass


# ─── Public API ───────────────────────────────────────────────────────────────

def start_fallback_server(last_heartbeat, port=80):
    """
    Start the emergency offline HTTP server.

    Call this as soon as heartbeat monitoring detects the Pi 5 is OFFLINE.
    After calling this, add poll_fallback_server() to your watchdog loop.

    Args:
        last_heartbeat (str): Human-readable timestamp of the last known-good
                              heartbeat, e.g. "2026-03-01 03:37:29".
        port (int):           TCP port to bind (default 80).

    Returns:
        True  — server is listening.
        False — socket error; watchdog should retry on next cycle.
    """
    global _server_sock, _fallback_active, _cached_response

    # Idempotent: calling while already active is a no-op
    if _fallback_active:
        return True

    sock = None
    try:
        # Pre-build response now so request handling is allocation-free
        _cached_response = _build_response(last_heartbeat)

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

        # Allow rapid rebind after a crash/reset (SO_REUSEADDR may be
        # unavailable on some MicroPython builds — handle gracefully)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass

        sock.bind(("0.0.0.0", port))
        sock.listen(2)          # Small backlog: one active + one queued
        sock.setblocking(False) # Non-blocking: accept() raises OSError if no client

        _server_sock = sock
        _fallback_active = True

        gc.collect()
        print("[Fallback] Listening on port {}.".format(port))
        return True

    except Exception:
        # Log failure without exposing internals
        print("[Fallback] Failed to start server.")
        _close_socket(sock)
        _cached_response = None
        gc.collect()
        return False


def poll_fallback_server():
    """
    Serve one pending HTTP connection (if any).

    Call this every iteration of the watchdog loop while the system is OFFLINE.
    Returns immediately (non-blocking) when no client is waiting.
    """
    global _server_sock, _fallback_active, _cached_response

    if not _fallback_active or _server_sock is None:
        return

    client = None
    try:
        # Non-blocking accept — raises OSError(EAGAIN) when queue is empty
        client, _addr = _server_sock.accept()

        # Short timeout so a slow client cannot block the watchdog loop
        client.settimeout(3.0)

        # Drain the HTTP request (we send the same page regardless of path/method)
        try:
            client.recv(512)
        except Exception:
            pass

        # Send the pre-built response
        client.sendall(_cached_response)

    except OSError:
        # EAGAIN / EWOULDBLOCK — no client in queue right now, completely normal
        pass
    except Exception:
        # Any other error: log minimally, do NOT crash the watchdog loop
        print("[Fallback] Request handling error.")
    finally:
        _close_socket(client)
        # client is the only per-request allocation; release it immediately
        gc.collect()


def stop_fallback_server():
    """
    Shut down the emergency server cleanly.

    Call this as soon as heartbeat monitoring confirms the Pi 5 is ONLINE again.
    Releases the socket, frees the response buffer, and returns to watchdog mode.
    """
    global _server_sock, _fallback_active, _cached_response

    _fallback_active  = False
    _close_socket(_server_sock)
    _server_sock     = None
    _cached_response = None

    gc.collect()
    print("[Fallback] Server stopped. Resuming watchdog monitoring.")


def is_active():
    """Return True if the fallback server is currently running."""
    return _fallback_active


# ─── Integration example ──────────────────────────────────────────────────────
#
# Drop-in pattern for an existing Pico 2 W watchdog loop.
# Replace the stub functions with your real heartbeat/Wi-Fi logic.
#
# ---------------------------------------------------------------------------
# import time
# import pico_fallback_server as fallback
#
# HEARTBEAT_INTERVAL = 30        # seconds between heartbeat checks
# HEARTBEAT_TIMEOUT  = 90        # seconds before declaring Pi 5 offline
# POLL_INTERVAL_MS   = 50        # ms between poll calls while offline (non-blocking)
#
# last_heartbeat_ts  = "Never"   # updated by your heartbeat logic
# pi5_online         = False     # set by your heartbeat logic
# server_started     = False
#
# def check_heartbeat():
#     """Stub — replace with your real HTTP / UART / GPIO heartbeat check."""
#     global last_heartbeat_ts
#     # ... perform check ...
#     # if success:
#     #     last_heartbeat_ts = "{}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}".format(*time.localtime()[:6])
#     #     return True
#     return False
#
# while True:
#     online = check_heartbeat()
#
#     if online and pi5_online is False:
#         # Pi 5 just came back online
#         pi5_online = True
#         if server_started:
#             fallback.stop_fallback_server()
#             server_started = False
#
#     elif not online and pi5_online is True:
#         # Pi 5 just went offline
#         pi5_online = False
#
#     # Start (or ensure) the fallback server is running while offline
#     if not pi5_online:
#         if not server_started:
#             server_started = fallback.start_fallback_server(last_heartbeat_ts)
#         else:
#             fallback.poll_fallback_server()
#
#     # Watchdog heartbeat interval
#     time.sleep_ms(POLL_INTERVAL_MS if not pi5_online else HEARTBEAT_INTERVAL * 1000)
