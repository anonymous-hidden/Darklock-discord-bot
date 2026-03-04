"""
pico_led_bridge.py  —  Pi5 bridge for the DarkLock LED Pico module
===================================================================
Reads ~/discord-bot/data/bot_status.json every STATUS_INTERVAL seconds
and sends the appropriate LED command to the Pico over USB serial.

Environment variables:
  PICO_LED_PORT   — serial device (default: /dev/pico-led)
  STATUS_FILE     — path to bot_status.json (default auto-detected)
  STATUS_INTERVAL — poll interval in seconds (default: 5)
  LED_BAUDRATE    — serial baud rate (default: 115200)

Systemd service file: pico-led-bridge.service
"""

import os
import sys
import json
import time
import serial
import logging
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────
PICO_PORT       = os.environ.get("PICO_LED_PORT",    "/dev/pico-led")
STATUS_INTERVAL = int(os.environ.get("STATUS_INTERVAL", "5"))
BAUDRATE        = int(os.environ.get("LED_BAUDRATE",    "115200"))

# Auto-detect bot_status.json next to this script or in data/
_HERE = Path(__file__).parent
_CANDIDATES = [
    Path(os.environ["STATUS_FILE"]) if "STATUS_FILE" in os.environ else None,
    _HERE / "data" / "bot_status.json",
    _HERE / "bot_status.json",
    Path("/home/darklock/discord-bot/data/bot_status.json"),
]
STATUS_FILE = next((p for p in _CANDIDATES if p and p.exists()), _CANDIDATES[2])

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [pico-led-bridge] %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(_HERE / "logs" / "pico_led_bridge.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("pico-led-bridge")

# ─── Status → LED command mapping ────────────────────────────────────────────
def derive_command(status: dict) -> str:
    """
    Map bot_status.json fields to a LED command string.

    Fields read:
      bot_online    (bool)  — is the bot connected to Discord?
      guild_count   (int)   — number of guilds (0 = suspicious)
      checking      (bool)  — optional, bridge is still initialising
      error_level   (str)   — optional: "warn" | "error" | "fail"
    """
    if not status:
        return "FAIL"

    # status file uses "online" key; fall back to "bot_online" for compatibility
    bot_online  = status.get("online", status.get("bot_online", False))
    guild_count = status.get("guild_count", 0)
    error_level = status.get("error_level", "").lower()
    checking    = status.get("checking",    False)

    # Explicit error overrides
    if error_level == "fail":
        return "FAIL"
    if error_level == "error":
        return "ERROR"
    if error_level == "warn":
        return "WARN"

    if checking:
        return "CHECKING"

    if not bot_online:
        return "FAIL"

    if guild_count == 0:
        return "WARN"

    return "OK"

# ─── Serial connection ────────────────────────────────────────────────────────
def open_serial() -> serial.Serial | None:
    try:
        s = serial.Serial(PICO_PORT, BAUDRATE, timeout=2)
        log.info("Opened serial port %s", PICO_PORT)
        # Wait for READY
        deadline = time.time() + 6
        while time.time() < deadline:
            line = s.readline().decode("utf-8", errors="replace").strip()
            if line == "READY":
                log.info("Pico responded READY")
                return s
            if line:
                log.debug("Pico boot: %s", line)
        log.warning("Pico did not send READY within 6 s — continuing anyway")
        return s
    except serial.SerialException as e:
        log.error("Cannot open %s: %s", PICO_PORT, e)
        return None

def send_cmd(ser: serial.Serial, cmd: str) -> bool:
    """Send LED command; return True on ACK."""
    try:
        line = f"LED:{cmd}\n"
        ser.write(line.encode())
        ser.flush()
        deadline = time.time() + 2
        while time.time() < deadline:
            resp = ser.readline().decode("utf-8", errors="replace").strip()
            if resp == f"ACK:{cmd}":
                return True
            if resp:
                log.debug("Pico: %s", resp)
        log.warning("No ACK for LED:%s", cmd)
        return False
    except serial.SerialException as e:
        log.error("Serial write error: %s", e)
        return False

def ping(ser: serial.Serial) -> bool:
    try:
        ser.write(b"PING\n")
        ser.flush()
        deadline = time.time() + 2
        while time.time() < deadline:
            resp = ser.readline().decode("utf-8", errors="replace").strip()
            if resp == "PONG":
                return True
        return False
    except serial.SerialException:
        return False

# ─── Status file reader ───────────────────────────────────────────────────────
def read_status() -> dict:
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        log.warning("Status file not found: %s", STATUS_FILE)
        return {}
    except json.JSONDecodeError as e:
        log.warning("Bad JSON in status file: %s", e)
        return {}

# ─── Main loop ────────────────────────────────────────────────────────────────
def run():
    log.info("Starting — port=%s interval=%ss status=%s", PICO_PORT, STATUS_INTERVAL, STATUS_FILE)

    ser = None
    last_cmd = None
    fail_count = 0
    last_sent_ms = 0   # timestamp of last LED command send (for periodic heartbeat)
    HEARTBEAT_INTERVAL = 60  # re-send current command every 60 s even if unchanged
    bad_read_streak = 0  # consecutive bad status reads before switching to FAIL

    # Initial connection: retry up to 10 times, then keep trying in loop
    for attempt in range(10):
        ser = open_serial()
        if ser:
            break
        log.warning("Retry %d/10 in 3 s…", attempt + 1)
        time.sleep(3)

    while True:
        # ── Reconnect if needed ──────────────────────────────────────────────
        if ser is None or not ser.is_open:
            log.info("Attempting serial reconnect…")
            ser = open_serial()
            if ser is None:
                fail_count += 1
                log.warning("Reconnect failed (#%d), retry in 10 s", fail_count)
                time.sleep(10)
                continue
            fail_count = 0
            last_cmd = None  # force resend after reconnect

        # ── Periodic health-check ────────────────────────────────────────────
        if not ping(ser):
            log.warning("Pico ping failed — closing port for reconnect")
            try:
                ser.close()
            except Exception:
                pass
            ser = None
            time.sleep(5)
            continue

        # ── Read status and derive command ───────────────────────────────────
        status = read_status()
        if not status:
            bad_read_streak += 1
            if bad_read_streak < 3:
                log.debug("Bad/empty status read (#%d), holding current mode", bad_read_streak)
                time.sleep(STATUS_INTERVAL)
                continue
        else:
            bad_read_streak = 0
        cmd = derive_command(status)

        now_ts = time.time()
        need_send = (cmd != last_cmd) or (now_ts - last_sent_ms >= HEARTBEAT_INTERVAL)
        if need_send:
            if cmd != last_cmd:
                log.info("Status change → LED:%s  (was %s)", cmd, last_cmd or "none")
            else:
                log.debug("Heartbeat — LED:%s", cmd)
            if send_cmd(ser, cmd):
                last_cmd = cmd
                last_sent_ms = now_ts
            else:
                # Assume port lost
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
        else:
            log.debug("No change — LED:%s", cmd)

        time.sleep(STATUS_INTERVAL)

# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        log.info("Interrupted — sending SHUTDOWN")
        # best-effort final shutdown
        try:
            s = serial.Serial(PICO_PORT, BAUDRATE, timeout=1)
            s.write(b"LED:SHUTDOWN\n")
            s.close()
        except Exception:
            pass
        sys.exit(0)
