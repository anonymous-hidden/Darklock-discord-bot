# =============================================================================
# main.py — Pico 2 W Watchdog + Emergency Fallback Server
# =============================================================================
# Behaviour:
#   MONITORING mode  →  issue HTTP GET /health to Pi 5 every HEARTBEAT_INTERVAL s
#   After FAILURE_THRESHOLD consecutive failures → FALLBACK mode
#   FALLBACK mode    →  serve a lightweight "Servers offline" HTML page on port 80
#   Pi 5 recovers    →  close server, return to MONITORING mode
#
# Design goals:
#   - Fully non-blocking via uasyncio (asyncio-compatible MicroPython API)
#   - Credentials/config never appear in this file
#   - Graceful error handling on every socket operation
#   - Safe to run 24 / 7 without memory leaks
# =============================================================================

import uasyncio as asyncio
import network
import ujson   as json
import time
import sys

# Config is the only place credentials live.
try:
    import config
except ImportError:
    print("[watchdog] FATAL: config.py missing. Cannot start.")
    sys.exit(1)

# LED helper — non-fatal if wiring not present
try:
    import led
except Exception as _le:
    print("[watchdog] LED unavailable:", _le)
    # Stub so call-sites don't need guards
    class _LedStub:
        def __getattr__(self, _): return lambda: None
    led = _LedStub()


# =============================================================================
# ── Global state ─────────────────────────────────────────────────────────────
# =============================================================================

_consecutive_failures:  int       = 0
_pi5_is_up:             bool      = True   # Optimistic initial assumption
_last_heartbeat_ts:     str       = "Never"
_emergency_server                 = None   # asyncio.Server instance when active


# =============================================================================
# ── Utilities ────────────────────────────────────────────────────────────────
# =============================================================================

def _now() -> str:
    """Return the current RTC time as a readable UTC string.
    Falls back to uptime ticks if the RTC has not been set."""
    try:
        t = time.localtime()
        # localtime() returns (year, month, mday, hour, minute, second, weekday, yearday)
        return "{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d} UTC".format(
            t[0], t[1], t[2], t[3], t[4], t[5]
        )
    except Exception:
        return "uptime {}s".format(time.ticks_ms() // 1000)


def _is_wifi_up() -> bool:
    """Quick Wi-Fi connectivity check without blocking."""
    try:
        wlan = network.WLAN(network.STA_IF)
        return wlan.isconnected()
    except Exception:
        return False


async def _ensure_wifi() -> bool:
    """
    If Wi-Fi has dropped, attempt a non-blocking reconnect.
    Yields control to the event loop while waiting so other tasks can run.
    """
    if _is_wifi_up():
        return True

    print("[watchdog] Wi-Fi lost — attempting reconnect...")
    led.purple()   # Purple = Wi-Fi lost
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)

    for _ in range(20):          # 20 × 1 s = 20 s maximum wait
        await asyncio.sleep(1)
        if wlan.isconnected():
            print("[watchdog] Wi-Fi reconnected:", wlan.ifconfig()[0])
            return True

    print("[watchdog] Wi-Fi reconnect failed.")
    return False


# =============================================================================
# ── Fallback HTML page ───────────────────────────────────────────────────────
# =============================================================================

def _build_fallback_html(last_seen: str) -> bytes:
    """
    Construct the offline status page.
    Returned as bytes, ready to embed directly in the HTTP response body.
    Inline CSS + minimal JS only — no external resources.
    """
    html = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Darklock Systems — Offline</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#07090f;color:#c9d1d9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;overflow:hidden}
.orb{position:fixed;border-radius:50%;filter:blur(80px);pointer-events:none;z-index:0}
.orb1{width:420px;height:420px;background:rgba(220,38,38,.07);top:-120px;right:-100px}
.orb2{width:380px;height:380px;background:rgba(124,58,237,.06);bottom:-100px;left:-80px}
.card{position:relative;z-index:1;background:rgba(13,17,23,.85);border:1px solid rgba(139,148,158,.12);border-radius:18px;padding:3rem 2.5rem 2.5rem;max-width:500px;width:100%;text-align:center;backdrop-filter:blur(12px)}
.logo{font-size:.7rem;font-weight:800;letter-spacing:.25em;text-transform:uppercase;color:#484f58;margin-bottom:2.25rem}
.icon-wrap{width:72px;height:72px;margin:0 auto 1.75rem;position:relative}
.icon-wrap svg{width:72px;height:72px}
.ring{fill:none;stroke:rgba(220,38,38,.18);stroke-width:1.5}
.ring-spin{fill:none;stroke:#dc2626;stroke-width:1.5;stroke-linecap:round;stroke-dasharray:30 70;animation:spin 2.4s linear infinite;transform-origin:36px 36px}
.icon-inner{fill:none;stroke:#f87171;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@keyframes spin{to{transform:rotate(360deg)}}
.badge{display:inline-flex;align-items:center;gap:.45rem;background:rgba(220,38,38,.1);color:#f87171;border:1px solid rgba(220,38,38,.25);padding:.35rem 1.1rem;border-radius:999px;font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:1.5rem}
.dot{width:6px;height:6px;background:#ef4444;border-radius:50%;animation:blink 1.8s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1;box-shadow:0 0 6px #ef4444}50%{opacity:.2;box-shadow:none}}
h1{font-size:1.75rem;font-weight:800;color:#f0f6fc;letter-spacing:-.02em;margin-bottom:.7rem}
.sub{color:#8b949e;font-size:.9375rem;line-height:1.7;margin-bottom:2rem}
.divider{border:none;border-top:1px solid rgba(139,148,158,.1);margin-bottom:1.75rem}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.75rem}
.stat{background:rgba(139,148,158,.05);border:1px solid rgba(139,148,158,.1);border-radius:10px;padding:.9rem .75rem}
.stat-label{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#484f58;margin-bottom:.35rem}
.stat-value{font-size:.85rem;font-weight:600;color:#8b949e}
.stat-value.red{color:#f87171}
.refresh-bar{background:rgba(139,148,158,.07);border-radius:999px;height:3px;margin-bottom:.75rem;overflow:hidden}
.refresh-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#2563eb);border-radius:999px;animation:fillbar 30s linear forwards}
@keyframes fillbar{from{width:0%}to{width:100%}}
.refresh-note{font-size:.72rem;color:#484f58}
.refresh-note span{color:#6e7681;font-weight:600}
</style>
</head>
<body>
<div class="orb orb1"></div>
<div class="orb orb2"></div>
<div class="card">
  <div class="logo">Darklock Systems</div>
  <div class="icon-wrap">
    <svg viewBox="0 0 72 72">
      <circle class="ring" cx="36" cy="36" r="30"/>
      <circle class="ring-spin" cx="36" cy="36" r="30"/>
      <path class="icon-inner" d="M36 24v14M36 44.5v1"/>
    </svg>
  </div>
  <div class="badge"><span class="dot"></span>Systems Offline</div>
  <h1>Service Unavailable</h1>
  <p class="sub">The Darklock servers are currently offline.<br>
  We are aware of the issue and working to restore service as quickly as possible.</p>
  <hr class="divider">
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Status</div>
      <div class="stat-value red">&#x25CF; Unreachable</div>
    </div>
    <div class="stat">
      <div class="stat-label">Last Heartbeat</div>
      <div class="stat-value">LAST_SEEN</div>
    </div>
  </div>
  <div class="refresh-bar"><div class="refresh-fill"></div></div>
  <p class="refresh-note">Auto&#8209;refreshing in <span id="t">30</span>s</p>
</div>
<script>
var s=30;var el=document.getElementById('t');
setInterval(function(){s--;if(s<=0)s=30;el.textContent=s},1000);
</script>
</body>
</html>
"""
    return html.replace("LAST_SEEN", last_seen).encode("utf-8")


# =============================================================================
# ── HTTP health check ────────────────────────────────────────────────────────
# =============================================================================

async def _check_heartbeat() -> bool:
    """
    Open a TCP connection to PI5_IP:PI5_PORT, send a minimal HTTP/1.0 GET
    request with the monitor token, read the response, and validate the JSON.

    HTTP/1.0 (not 1.1) is used deliberately so the server closes the connection
    after the response — no chunked encoding, no keep-alive complexity.

    Returns True  → Pi 5 is healthy.
    Returns False → any network error, timeout, HTTP error, or bad JSON.
    """
    reader  = None
    writer  = None
    try:
        # ── Open connection (with timeout) ────────────────────────────────────
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(config.PI5_IP, config.PI5_PORT),
            timeout=config.REQUEST_TIMEOUT,
        )

        # ── Send request ──────────────────────────────────────────────────────
        # Token is injected from config — never embedded in this source file.
        request = (
            "GET /health HTTP/1.0\r\n"
            "Host: {host}:{port}\r\n"
            "X-Monitor-Token: {token}\r\n"
            "Accept: application/json\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).format(
            host  = config.PI5_IP,
            port  = config.PI5_PORT,
            token = config.MONITOR_TOKEN,
        )
        writer.write(request.encode("utf-8"))
        await writer.drain()

        # ── Read response (with timeout) ──────────────────────────────────────
        raw = await asyncio.wait_for(
            reader.read(4096),
            timeout=config.REQUEST_TIMEOUT,
        )

        # ── Locate HTTP body ──────────────────────────────────────────────────
        sep = raw.find(b"\r\n\r\n")
        if sep == -1:
            print("[watchdog] Malformed HTTP response (no header/body separator).")
            return False

        # ── Quick HTTP status check ───────────────────────────────────────────
        first_line = raw[:raw.find(b"\r\n")].decode("utf-8", "ignore")
        parts = first_line.split(" ", 2)
        if len(parts) >= 2 and not parts[1].startswith("2"):
            print("[watchdog] Non-2xx status:", parts[1])
            return False

        # ── Parse and validate JSON body ──────────────────────────────────────
        body = raw[sep + 4:].decode("utf-8", "ignore").strip()
        if not body:
            print("[watchdog] Empty response body.")
            return False

        data = json.loads(body)

        if not isinstance(data, dict):
            print("[watchdog] Response is not a JSON object.")
            return False

        # Require at minimum: status == "ok" and a timestamp field.
        if data.get("status") != "ok":
            print("[watchdog] status field is not 'ok':", data.get("status"))
            return False

        if "timestamp" not in data:
            print("[watchdog] Response missing 'timestamp' field.")
            return False

        return True  # ← All checks passed

    except asyncio.TimeoutError:
        print("[watchdog] Heartbeat timed out ({s}s).".format(s=config.REQUEST_TIMEOUT))
        return False

    except Exception as exc:
        print("[watchdog] Heartbeat error:", type(exc).__name__, str(exc))
        return False

    finally:
        # Always close the connection, even on error paths.
        if writer is not None:
            try:
                writer.close()
                await asyncio.wait_for(writer.wait_closed(), timeout=2)
            except Exception:
                pass


# =============================================================================
# ── Emergency HTTP server ────────────────────────────────────────────────────
# =============================================================================

async def _handle_client(reader, writer) -> None:
    """
    Serve the fallback HTML page to any incoming HTTP connection.
    We do not inspect the request — every path returns the same status page.
    """
    try:
        # Drain the client's request to avoid connection-reset on the client side.
        # Timeout prevents a slow client from blocking the server task.
        await asyncio.wait_for(reader.read(1024), timeout=3)
    except Exception:
        pass  # Request read errors are non-fatal

    try:
        body     = _build_fallback_html(_last_heartbeat_ts)
        headers  = (
            "HTTP/1.0 200 OK\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "Content-Length: {length}\r\n"
            "Cache-Control: no-store, no-cache\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).format(length=len(body)).encode("utf-8")

        writer.write(headers + body)
        await writer.drain()

    except Exception as exc:
        print("[server] Client send error:", exc)

    finally:
        try:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), timeout=2)
        except Exception:
            pass


async def _start_emergency_server() -> None:
    """Bind port 80 and start serving the fallback page."""
    global _emergency_server

    if _emergency_server is not None:
        return  # Already running

    try:
        _emergency_server = await asyncio.start_server(
            _handle_client,
            "0.0.0.0",
            config.FALLBACK_PORT,
            backlog=4,
        )
        print("[server] Emergency server listening on :{port}".format(
            port=config.FALLBACK_PORT
        ))
    except Exception as exc:
        print("[server] Could not start emergency server:", exc)
        _emergency_server = None


def _stop_emergency_server() -> None:
    """Release the port and stop accepting new connections."""
    global _emergency_server

    if _emergency_server is None:
        return

    try:
        _emergency_server.close()
        print("[server] Emergency server stopped.")
    except Exception as exc:
        print("[server] Error stopping server:", exc)
    finally:
        _emergency_server = None


# =============================================================================
# ── Main monitoring loop ─────────────────────────────────────────────────────
# =============================================================================

async def _monitor_loop() -> None:
    """
    Core watchdog coroutine.

    State machine:
        MONITORING:  wait HEARTBEAT_INTERVAL, check heartbeat
            → success: reset failure counter
            → failure × FAILURE_THRESHOLD: transition to FALLBACK

        FALLBACK:    emergency server is running, keep checking heartbeat
            → success: shut down server, transition to MONITORING
            → failure: increment counter, stay in FALLBACK
    """
    global _consecutive_failures, _pi5_is_up, _last_heartbeat_ts

    print("[watchdog] Monitoring started. Target:", config.PI5_IP)

    while True:
        # ── Wait before each check ────────────────────────────────────────────
        await asyncio.sleep(config.HEARTBEAT_INTERVAL)

        # ── Ensure Wi-Fi before attempting a request ──────────────────────────
        if not await _ensure_wifi():
            # Can't check without Wi-Fi; count as a failure so the fallback
            # server still activates if connectivity is lost long-term.
            _consecutive_failures += 1
            print("[watchdog] Skipping check (no Wi-Fi). Failures:", _consecutive_failures)

            if _consecutive_failures >= config.FAILURE_THRESHOLD and _pi5_is_up:
                _pi5_is_up = False
                await _start_emergency_server()

            continue

        # ── Perform health check ──────────────────────────────────────────────
        healthy = await _check_heartbeat()

        if healthy:
            # ── Pi 5 is responding ────────────────────────────────────────────
            _last_heartbeat_ts = _now()

            if not _pi5_is_up:
                # Recovery: Pi 5 has just come back online.
                print("[watchdog] Pi 5 is back ONLINE. Last heartbeat:", _last_heartbeat_ts)
                _stop_emergency_server()
                _pi5_is_up = True

            _consecutive_failures = 0
            led.green()   # Green = healthy
            print("[watchdog] OK  ✓  Pi 5 healthy at", _last_heartbeat_ts)

        else:
            # ── Failed check ──────────────────────────────────────────────────
            _consecutive_failures += 1
            print("[watchdog] FAIL ({f}/{t})  Pi 5 did not respond.".format(
                f=_consecutive_failures,
                t=config.FAILURE_THRESHOLD,
            ))

            if _consecutive_failures < config.FAILURE_THRESHOLD:
                led.amber()   # Amber = warning, not yet declared down

            if _consecutive_failures >= config.FAILURE_THRESHOLD and _pi5_is_up:
                # Threshold crossed: begin fallback mode.
                _pi5_is_up = False
                led.red()     # Red = Pi 5 DOWN
                print("[watchdog] Pi 5 marked DOWN — starting emergency server.")
                await _start_emergency_server()


# =============================================================================
# ── Entry point ──────────────────────────────────────────────────────────────
# =============================================================================

async def _main() -> None:
    """
    Top-level async entry point.
    Only the monitoring loop needs to run — the emergency server is started/
    stopped as a side effect of the monitor loop when needed.
    """
    print("=" * 60)
    print(" Darklock Pico 2 W Watchdog")
    print(" Target:", config.PI5_IP)
    print(" Interval:", config.HEARTBEAT_INTERVAL, "s  |  Threshold:",
          config.FAILURE_THRESHOLD, "failures")
    print("=" * 60)

    # ── Start WebREPL inside the event loop so it shares the same asyncio context ──
    # webrepl.start() must be called inside asyncio.run() to register its
    # tasks on the correct (live) event loop. Calling it in boot.py before
    # asyncio.run() orphans it on a discarded loop.
    if getattr(config, 'WEBREPL_ENABLED', False):
        try:
            import webrepl
            webrepl.start()
            import network
            ip = network.WLAN(network.STA_IF).ifconfig()[0]
            print("[watchdog] WebREPL started on ws://{}:8266".format(ip))
        except Exception as _we:
            print("[watchdog] WebREPL unavailable (non-fatal):", _we)

    await _monitor_loop()


# Run — if asyncio.run raises an unhandled exception, restart after 5 s.
# This prevents a transient error from permanently killing the watchdog.
while True:
    try:
        asyncio.run(_main())
    except Exception as exc:
        print("[watchdog] Unhandled top-level exception:", exc)
        print("[watchdog] Restarting in 5 s...")
        import time as _t
        _t.sleep(5)
