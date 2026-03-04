#!/usr/bin/env python3
"""
upload_to_pico.py
Interrupts a running MicroPython program, enters raw REPL, writes
config.py / led.py / boot.py / main.py via base64-encoded chunks,
then soft-resets the Pico.
Run from the pico-watchdog/ directory.
"""

import serial
import time
import sys
import os
import base64

PORT     = "/dev/ttyACM0"
BAUD     = 115200
FILES    = ["config.py", "led.py", "boot.py", "main.py"]
CHUNK_SZ = 512   # bytes per encoded chunk (safe for Pico input buffer)


def wait_for(s: serial.Serial, marker: bytes, timeout: float = 8.0) -> bytes:
    buf      = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        n = s.in_waiting
        chunk = s.read(n if n else 1)
        if chunk:
            buf += chunk
            sys.stdout.buffer.write(chunk)
            sys.stdout.flush()
            if marker in buf:
                return buf
    return buf


def raw_exec(s: serial.Serial, code: str, tag: str, timeout: float = 15.0) -> bool:
    """Send code in raw REPL mode (Ctrl+A … Ctrl+D) and wait for tag."""
    s.write(b"\x01")          # Ctrl+A — enter raw REPL
    time.sleep(0.05)
    s.write(code.encode("utf-8"))
    s.write(b"\x04")          # Ctrl+D — execute
    result = wait_for(s, tag.encode(), timeout=timeout)
    # Return to normal REPL so next command can use Ctrl+A again
    s.write(b"\x02")          # Ctrl+B — exit raw REPL
    time.sleep(0.1)
    s.reset_input_buffer()
    return tag.encode() in result


def upload_file(s: serial.Serial, path: str) -> None:
    filename = os.path.basename(path)
    with open(path, "rb") as f:
        data = f.read()

    print(f"\n→ Uploading {filename} ({len(data)} bytes)...")

    # Open file for writing
    if not raw_exec(s,
        f"import ubinascii; _f=open('{filename}','wb')\nprint('OPEN_OK')\n",
        "OPEN_OK"):
        print(f"  ✗ Could not open {filename} on Pico for writing")
        sys.exit(1)

    # Send in base64-encoded chunks to avoid all binary/escape issues
    b64 = base64.b64encode(data)
    for i in range(0, len(b64), CHUNK_SZ):
        chunk = b64[i:i + CHUNK_SZ].decode("ascii")
        code  = f"_f.write(ubinascii.a2b_base64(b'{chunk}'))\nprint('C_OK')\n"
        if not raw_exec(s, code, "C_OK", timeout=10):
            print(f"  ✗ Chunk {i // CHUNK_SZ} of {filename} failed")
            sys.exit(1)
        sys.stdout.write(".")
        sys.stdout.flush()

    # Close and verify
    if not raw_exec(s, "_f.close()\nprint('CLOSE_OK')\n", "CLOSE_OK"):
        print(f"  ✗ Failed to close {filename}")
        sys.exit(1)

    print(f"\n  ✓ {filename} written ({len(data)} bytes)")


def main():
    print(f"Opening {PORT}...")
    try:
        s = serial.Serial(PORT, BAUD, timeout=0.5)
    except serial.SerialException as e:
        print(f"Cannot open {PORT}: {e}")
        sys.exit(1)

    time.sleep(0.5)

    # ── Interrupt any running program ─────────────────────────────────────────
    # Send Ctrl+D to soft-reset, wait 1.5s for boot.py to start its 2s sleep,
    # then send a single Ctrl+C. Retry up to 4 times if needed.
    print("Interrupting Pico (soft reset + timed Ctrl+C)...")
    buf = b""
    for attempt in range(5):
        s.reset_input_buffer()
        s.reset_output_buffer()
        s.write(b"\x04")          # Ctrl+D — soft reset
        time.sleep(1.5)           # wait for MicroPython to reboot + boot.py sleep begins
        s.reset_input_buffer()    # discard boot messages
        s.write(b"\x03")          # single Ctrl+C to interrupt the sleep
        time.sleep(0.3)
        s.write(b"\x03")          # one more for reliability
        time.sleep(1.0)           # let the prompt appear
        buf = s.read(s.in_waiting)
        sys.stdout.buffer.write(buf); sys.stdout.flush()
        if b">>>" in buf:
            break
        # Also try Ctrl+B in case we ended up in raw REPL
        s.write(b"\x02")
        time.sleep(0.5)
        buf += s.read(s.in_waiting)
        if b">>>" in buf:
            break
        print(f"\n  attempt {attempt+1} — no prompt yet, retrying...")

    if b">>>" not in buf:
        # Last resort: just send \r\n and hope we're at a prompt
        s.write(b"\r\n")
        time.sleep(0.5)
        buf += s.read(s.in_waiting)

    if b">>>" not in buf:
        print("\nERROR: Could not get REPL prompt. Is the Pico connected?")
        sys.exit(1)
    print("\nGot REPL prompt.")

    # ── Upload each file ──────────────────────────────────────────────────────
    for filepath in FILES:
        if not os.path.exists(filepath):
            print(f"ERROR: {filepath} not found in current directory.")
            s.close()
            sys.exit(1)
        upload_file(s, filepath)

    # ── Soft reset ───────────────────────────────────────────────────────────
    print("\nSoft-resetting Pico...")
    s.write(b"\x02\x04")   # Ctrl+B (normal REPL) then Ctrl+D (soft reset)
    time.sleep(3)

    print("\n── First boot output (3 s) ──────────────────────────────────────")
    deadline = time.time() + 3
    while time.time() < deadline:
        n = s.in_waiting
        if n:
            sys.stdout.buffer.write(s.read(n))
            sys.stdout.flush()
        else:
            time.sleep(0.05)

    s.close()
    print("\n\nDone. Watchdog is running.")


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()

