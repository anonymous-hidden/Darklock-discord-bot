"""
_webrepl_upload2.py — Upload files to Pico via WebREPL using websocket-client lib

Uses the websocket-client library for a proper WebSocket connection,
then the MicroPython WebREPL binary PUT protocol for file uploads.
"""

import struct
import time
import os
import sys

try:
    import websocket
except ImportError:
    print("ERROR: pip3 install websocket-client")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────────
PICO_IP   = "192.168.50.200"
PICO_PORT = 8266
PASSWORD  = "dlpico9"
FILES     = ["config.py", "led.py", "main.py", "boot.py"]

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    url = f"ws://{PICO_IP}:{PICO_PORT}"
    print(f"Connecting to {url} ...")

    ws = websocket.WebSocket()
    ws.settimeout(10)
    try:
        ws.connect(url)
    except Exception as e:
        print(f"ERROR: WebSocket connect failed: {e}")
        sys.exit(1)

    print("Connected. Reading password prompt...")
    try:
        prompt = ws.recv()
        print(f"  Prompt: {prompt!r}")
    except Exception as e:
        print(f"  No prompt received: {e}")

    # Send password
    print(f"  Sending password...")
    ws.send(PASSWORD + "\r\n")
    time.sleep(1)

    try:
        resp = ws.recv()
        print(f"  Login response: {resp!r}")
    except Exception as e:
        print(f"  No login response: {e}")

    # Upload each file using WebREPL PUT protocol
    for fname in FILES:
        local_path = os.path.join(script_dir, fname)
        if not os.path.exists(local_path):
            print(f"  SKIP {fname}")
            continue

        with open(local_path, "rb") as f:
            file_data = f.read()

        fname_bytes = fname.encode("utf-8")
        size = len(file_data)
        print(f"\n  Uploading {fname} ({size} bytes)...")

        # Build PUT request: b'WA' + op(1) + reserved(0) + fname_len + file_size
        rec = struct.pack("<2sBBHI", b"WA", 1, 0, len(fname_bytes), size)
        ws.send_binary(rec + fname_bytes)

        # Wait for initial ack
        try:
            ack = ws.recv()
            print(f"    Initial ack: {ack!r}")
        except Exception as e:
            print(f"    No initial ack: {e}")

        # Send file data in chunks
        CHUNK = 1024
        sent = 0
        while sent < size:
            chunk = file_data[sent:sent + CHUNK]
            ws.send_binary(chunk)
            sent += len(chunk)
            pct = int(sent * 100 / size)
            print(f"\r    Sent {sent}/{size} ({pct}%)", end="", flush=True)
        print()

        # Wait for completion
        try:
            result = ws.recv()
            print(f"    Result: {result!r}")
        except Exception as e:
            print(f"    No result: {e}")

    # Soft reset
    print("\nSending Ctrl+D (soft reset)...")
    try:
        ws.send("\x04")
    except Exception:
        pass

    time.sleep(1)
    ws.close()
    print("Done. Pico should reboot with new code.")

if __name__ == "__main__":
    main()
