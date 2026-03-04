"""
_webrepl_upload.py — Upload files to Pico via WebREPL (Wi-Fi, no USB needed)

Uses the MicroPython WebREPL binary protocol to PUT files, then
sends a soft-reset command so the Pico reboots with the new code.

Usage:  python3 _webrepl_upload.py
"""

import struct
import hashlib
import socket
import time
import os
import sys

# ── Configuration ─────────────────────────────────────────────────────────────
PICO_IP   = "192.168.50.200"
PICO_PORT = 8266
PASSWORD  = "dlpico9"
FILES     = ["config.py", "led.py", "main.py", "boot.py"]

# ── WebSocket helpers (minimal, MicroPython WebREPL compatible) ───────────────

def ws_connect(ip, port, timeout=10):
    """Open a raw WebSocket connection to the Pico WebREPL."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    sock.connect((ip, port))

    # WebSocket handshake
    key = "dGhlIHNhbXBsZSBub25jZQ=="  # fixed nonce, fine for local use
    handshake = (
        f"GET / HTTP/1.1\r\n"
        f"Host: {ip}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    sock.sendall(handshake.encode())

    # Read HTTP response headers
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(1024)
        if not chunk:
            raise ConnectionError("WebSocket handshake failed — no response")
        resp += chunk

    if b"101" not in resp.split(b"\r\n")[0]:
        raise ConnectionError(f"WebSocket handshake rejected: {resp[:200]}")

    return sock


def ws_read(sock, timeout=10):
    """Read one WebSocket frame, return the payload bytes."""
    old_timeout = sock.gettimeout()
    sock.settimeout(timeout)
    try:
        header = _recv_exact(sock, 2)
        opcode = header[0] & 0x0F
        length = header[1] & 0x7F

        if length == 126:
            length = struct.unpack(">H", _recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack(">Q", _recv_exact(sock, 8))[0]

        data = _recv_exact(sock, length) if length > 0 else b""

        # opcode 8 = close
        if opcode == 8:
            raise ConnectionError("WebSocket closed by peer")

        return data
    finally:
        sock.settimeout(old_timeout)


def ws_write(sock, data):
    """Send a WebSocket text or binary frame (client-masked)."""
    if isinstance(data, str):
        data = data.encode("utf-8")
        opcode = 0x81  # text
    else:
        opcode = 0x82  # binary

    frame = bytearray()
    frame.append(opcode)

    length = len(data)
    if length < 126:
        frame.append(0x80 | length)  # mask bit set
    elif length < 65536:
        frame.append(0x80 | 126)
        frame += struct.pack(">H", length)
    else:
        frame.append(0x80 | 127)
        frame += struct.pack(">Q", length)

    # Mask key (all zeros for simplicity — local network only)
    mask = b"\x00\x00\x00\x00"
    frame += mask
    frame += data  # XOR with all-zero mask = data unchanged

    sock.sendall(bytes(frame))


def _recv_exact(sock, n):
    """Receive exactly n bytes."""
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Connection lost while reading")
        buf += chunk
    return buf


# ── WebREPL protocol helpers ─────────────────────────────────────────────────

def webrepl_login(sock, password):
    """Authenticate with the WebREPL password prompt."""
    # WebREPL sends a password prompt as text
    prompt = ws_read(sock, timeout=5)
    print(f"  WebREPL prompt: {prompt!r}")

    if b"Password:" in prompt or b"password" in prompt.lower():
        ws_write(sock, password + "\r\n")
        response = ws_read(sock, timeout=5)
        print(f"  Login response: {response!r}")
        if b"denied" in response.lower():
            raise PermissionError("WebREPL login denied — wrong password")
        return True
    elif b"WebREPL connected" in prompt:
        # Already logged in
        return True
    else:
        # Maybe no password required or already past prompt
        print(f"  Unexpected prompt, trying to continue: {prompt!r}")
        return True


def webrepl_put_file(sock, local_path, remote_name):
    """Upload a file using the WebREPL binary PUT protocol.

    Protocol (from webrepl_cli.py):
    - Client sends: "PUT" struct: b'WA' + struct(BBHIQ) = sig, op, flags, fname_len, file_len
    - Then sends the remote filename
    - Server replies with 0-byte or status
    - Client sends file data in chunks
    - Server replies with final status
    """
    with open(local_path, "rb") as f:
        file_data = f.read()

    fname_bytes = remote_name.encode("utf-8")

    # Build the PUT request header
    # Sig: b'WA', Operation: 1 (PUT), Flags: 0, Filename length: len, File size: len
    rec = struct.pack("<2sBBHI", b"WA", 1, 0, len(fname_bytes), len(file_data))
    ws_write(sock, rec + fname_bytes)

    # Wait for initial response
    resp = ws_read(sock, timeout=5)
    if len(resp) >= 1 and resp[-1] != 0:
        sig = resp[:2] if len(resp) >= 2 else b""
        print(f"    PUT rejected for {remote_name}, response: {resp!r}")
        return False

    # Send file data in chunks
    CHUNK = 1024
    sent = 0
    while sent < len(file_data):
        chunk = file_data[sent:sent + CHUNK]
        ws_write(sock, chunk)
        sent += len(chunk)

    # Wait for completion response
    resp = ws_read(sock, timeout=10)
    if len(resp) >= 1 and resp[-1] == 0:
        return True
    else:
        print(f"    PUT completion error for {remote_name}, response: {resp!r}")
        return False


def webrepl_exec(sock, code):
    """Execute Python code on the Pico via WebREPL text frames."""
    ws_write(sock, code + "\r\n")
    time.sleep(0.5)
    # Read any output
    try:
        while True:
            data = ws_read(sock, timeout=2)
            if data:
                print(f"    > {data.decode('utf-8', 'replace').strip()}")
    except (socket.timeout, ConnectionError, OSError):
        pass


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    print(f"Connecting to Pico WebREPL at {PICO_IP}:{PICO_PORT}...")
    try:
        sock = ws_connect(PICO_IP, PICO_PORT)
    except Exception as e:
        print(f"ERROR: Could not connect: {e}")
        sys.exit(1)

    print("Connected. Authenticating...")
    try:
        webrepl_login(sock, PASSWORD)
    except Exception as e:
        print(f"ERROR: Login failed: {e}")
        sock.close()
        sys.exit(1)

    print("Authenticated. Uploading files...\n")
    results = {}
    for fname in FILES:
        local_path = os.path.join(script_dir, fname)
        if not os.path.exists(local_path):
            print(f"  SKIP {fname} (not found locally)")
            continue

        size = os.path.getsize(local_path)
        print(f"  Uploading {fname} ({size} bytes)...")
        try:
            ok = webrepl_put_file(sock, local_path, fname)
            results[fname] = ok
            status = "OK" if ok else "FAILED"
            print(f"    {fname} — {status}")
        except Exception as e:
            print(f"    {fname} — ERROR: {e}")
            results[fname] = False

    print(f"\n{'='*50}")
    print("Upload summary:")
    for fname, ok in results.items():
        print(f"  {'✓' if ok else '✗'} {fname}")

    # Soft-reset the Pico so it runs the new code
    print("\nSending soft-reset (Ctrl+D)...")
    try:
        ws_write(sock, "\x04")
        time.sleep(1)
    except Exception:
        pass

    sock.close()
    print("Done. Pico should be rebooting with new code.")


if __name__ == "__main__":
    main()
