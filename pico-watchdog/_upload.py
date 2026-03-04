"""
_upload.py  — One-shot raw-REPL file uploader for Pico 2 W
Run: python3 _upload.py
"""

import signal
# Ignore SIGINT for the duration of this script so stray ^C in the
# terminal PTY buffer don't kill the upload mid-transfer.
signal.signal(signal.SIGINT, signal.SIG_IGN)

import serial
import time
import os
import sys
import binascii

PORT     = "/dev/ttyACM0"
BAUD     = 115200
FILES    = ["config.py", "led.py", "main.py", "boot.py", "pico_fallback_server.py"]
CHUNK_SZ = 200   # bytes per write chunk (raw REPL safe limit)

# ─── Helpers ──────────────────────────────────────────────────────────────────

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
    """Execute code in raw REPL, return stdout+stderr."""
    s.write(code.encode("utf-8") + b'\x04')
    # raw REPL response: b'OK' then output then b'\x04>'
    resp = wait_for(s, b'\x04>', timeout)
    return resp


# ─── Main ─────────────────────────────────────────────────────────────────────

script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

print(f"Opening {PORT}...")
# Disable tty signal processing before opening — prevents any stray \x03
# bytes from the Pico's USB CDC from generating SIGINT in this process.
import subprocess
subprocess.run(['stty', '-ISIG', '-f', PORT], capture_output=True)   # macOS
subprocess.run(['stty', '-ISIG', '-F', PORT], capture_output=True)   # Linux
s = serial.Serial(PORT, BAUD, timeout=1)
time.sleep(0.5)

# 1. Interrupt any running code (send Ctrl+C twice)
print("Interrupting running code...")
s.write(b'\x03\x03')
time.sleep(0.5)
s.read_all()   # flush output

# 2. Enter raw REPL (Ctrl+A)
print("Entering raw REPL...")
s.write(b'\x01')
resp = wait_for(s, b'raw REPL', timeout=3.0)
if b'raw REPL' not in resp:
    # Try once more
    s.write(b'\x03\x03\x01')
    resp = wait_for(s, b'raw REPL', timeout=3.0)

if b'raw REPL' not in resp and b'>' not in resp:
    print("ERROR: Could not enter raw REPL. Response:", repr(resp))
    s.close()
    sys.exit(1)

print("  Raw REPL ready.")
s.read_all()   # drain any leftover prompt chars

# 3. Upload each file
for fname in FILES:
    if not os.path.exists(fname):
        print(f"  SKIP {fname} (not found locally)")
        continue

    with open(fname, "rb") as f:
        data = f.read()

    print(f"  Uploading {fname} ({len(data)} bytes)...")

    # Write using hex chunks to avoid any encoding issues
    # First, open the file for writing on the Pico
    setup = f"_f = open('{fname}', 'wb')\n"
    raw_exec(s, setup)

    # Send data in hex-encoded chunks
    for i in range(0, len(data), CHUNK_SZ):
        chunk = data[i:i + CHUNK_SZ]
        hex_str = binascii.hexlify(chunk).decode("ascii")
        cmd = f"import ubinascii; _f.write(ubinascii.unhexlify('{hex_str}'))\n"
        raw_exec(s, cmd, timeout=5.0)

    # Close the file
    result = raw_exec(s, "_f.close(); print('OK')\n")
    if b'OK' in result:
        print(f"    {fname} — done")
    else:
        print(f"    {fname} — WARNING unexpected response: {repr(result[-80:])}")

# 4. Verify files on Pico
print("\nVerifying Pico filesystem...")
result = raw_exec(s, "import os; print(os.listdir('/'))\n", timeout=5.0)
print(" ", repr(result[2:result.find(b'\x04>') if b'\x04>' in result else None]))

# 5. Soft-reset so new code runs immediately
print("\nSoft-resetting Pico (Ctrl+D)...")
s.write(b'\x04')
time.sleep(0.5)
boot_out = wait_for(s, b'Connecting', timeout=6.0)
print("  Boot output:", repr(boot_out[:120]))

s.close()
print("\nAll done. Pico is running new code.")
