#!/usr/bin/env python3
"""
_catch_and_upload.py — Wait for Pico to appear on USB, immediately interrupt, and upload files.

Run this FIRST, then plug the Pico into the computer USB port.
The script polls for /dev/ttyACM0, and the instant it appears,
blasts Ctrl+C repeatedly to catch the MicroPython REPL during
boot, then enters raw REPL and uploads all files.
"""

import signal
signal.signal(signal.SIGINT, signal.SIG_IGN)   # Protect from SIGINT storm

import serial
import time
import os
import sys
import binascii
import subprocess

PORT     = "/dev/ttyACM0"
BAUD     = 115200
FILES    = ["config.py", "led.py", "main.py", "boot.py"]
CHUNK_SZ = 200

def wait_for(s, marker: bytes, timeout: float = 4.0) -> bytes:
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        chunk = s.read(s.in_waiting or 1)
        buf += chunk
        if marker in buf:
            return buf
        time.sleep(0.05)
    return buf

def raw_exec(s, code: str, timeout: float = 8.0) -> bytes:
    s.write(code.encode("utf-8") + b'\x04')
    resp = wait_for(s, b'\x04>', timeout)
    return resp

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    # Kill any processes holding the port
    subprocess.run(['pkill', '-f', 'mpremote'], capture_output=True)
    subprocess.run(['pkill', '-f', 'minicom'], capture_output=True)

    # Disable ModemManager temporarily
    subprocess.run(['sudo', 'systemctl', 'stop', 'ModemManager'], capture_output=True)

    print("=" * 60)
    print("  WAITING FOR PICO TO APPEAR ON USB")
    print("  Plug the Pico into the computer NOW")
    print("=" * 60)

    # Poll for the device to appear
    while not os.path.exists(PORT):
        sys.stdout.write(".")
        sys.stdout.flush()
        time.sleep(0.2)

    print(f"\n\n[*] {PORT} detected! Waiting 0.5s for device to stabilize...")
    time.sleep(0.5)

    # Disable tty signal processing
    subprocess.run(['stty', '-ISIG', '-F', PORT], capture_output=True)

    print("[*] Opening serial port...")
    try:
        s = serial.Serial(PORT, BAUD, timeout=0.5, dsrdtr=False, rtscts=False)
    except Exception as e:
        print(f"ERROR: Could not open serial port: {e}")
        sys.exit(1)

    # BLAST Ctrl+C repeatedly for 3 seconds to catch the REPL during boot
    print("[*] Sending interrupt barrage (Ctrl+C) for 3 seconds...")
    end = time.time() + 3.0
    while time.time() < end:
        s.write(b'\x03\x03')      # Two Ctrl+C
        time.sleep(0.1)
        # Read and discard any output
        if s.in_waiting:
            data = s.read(s.in_waiting)
            text = data.decode('utf-8', 'replace')
            if '>>>' in text:
                print(f"\n[*] Got REPL prompt!")
                break

    time.sleep(0.3)
    s.read_all()  # flush

    # Now quickly enter raw REPL
    print("[*] Entering raw REPL (Ctrl+A)...")
    s.write(b'\x01')
    resp = wait_for(s, b'raw REPL', timeout=3.0)

    if b'raw REPL' not in resp:
        # Try harder: more Ctrl+C then Ctrl+A
        print("[*] Retrying: more Ctrl+C then Ctrl+A...")
        s.write(b'\x03\x03')
        time.sleep(0.5)
        s.read_all()
        s.write(b'\x01')
        resp = wait_for(s, b'raw REPL', timeout=3.0)

    if b'raw REPL' not in resp and b'>' not in resp:
        print(f"[!] Could not enter raw REPL. Last response: {resp!r}")
        # Try one more approach: send Ctrl+B (normal REPL) then Ctrl+A
        s.write(b'\x02')
        time.sleep(0.5)
        s.read_all()
        s.write(b'\x03\x03')
        time.sleep(0.5)
        s.read_all()
        s.write(b'\x01')
        resp = wait_for(s, b'raw REPL', timeout=3.0)
        if b'raw REPL' not in resp:
            print(f"[!] FATAL: Cannot enter raw REPL. Response: {resp!r}")
            s.close()
            sys.exit(1)

    print("[*] Raw REPL ready!")
    s.read_all()   # drain

    # Upload each file
    success = 0
    for fname in FILES:
        if not os.path.exists(fname):
            print(f"  SKIP {fname} (not found)")
            continue

        with open(fname, "rb") as f:
            data = f.read()

        print(f"  Uploading {fname} ({len(data)} bytes)...")

        # Open file on Pico
        raw_exec(s, f"_f = open('{fname}', 'wb')\n")

        # Send data in hex-encoded chunks
        for i in range(0, len(data), CHUNK_SZ):
            chunk = data[i:i + CHUNK_SZ]
            hex_str = binascii.hexlify(chunk).decode("ascii")
            cmd = f"import ubinascii; _f.write(ubinascii.unhexlify('{hex_str}'))\n"
            raw_exec(s, cmd, timeout=5.0)
            pct = min(100, int((i + CHUNK_SZ) * 100 / len(data)))
            print(f"\r    Progress: {pct}%", end="", flush=True)

        # Close file
        result = raw_exec(s, "_f.close(); print('OK')\n")
        if b'OK' in result:
            print(f"\r    {fname} — DONE" + " " * 20)
            success += 1
        else:
            print(f"\r    {fname} — WARNING: {result[-60:]!r}")

    # Verify
    print(f"\n[*] Verifying filesystem...")
    result = raw_exec(s, "import os; print(os.listdir('/'))\n", timeout=5.0)
    clean = result[2:result.find(b'\x04>') if b'\x04>' in result else None]
    print(f"  Files on Pico: {clean.decode('utf-8', 'replace')}")

    # Soft reset
    print(f"\n[*] Uploaded {success}/{len(FILES)} files. Soft-resetting Pico...")
    s.write(b'\x04')   # Ctrl+D = soft reset in raw REPL
    time.sleep(1)

    # Read boot output
    boot_out = wait_for(s, b'healthy', timeout=30.0)
    print(f"  Boot output (first 200 chars):\n  {boot_out[:200].decode('utf-8', 'replace')}")

    s.close()
    print(f"\n{'='*60}")
    print(f"  ALL DONE — Pico should now be running updated code")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
