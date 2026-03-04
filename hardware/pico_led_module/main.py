"""
DarkLock LED Module — Raspberry Pi Pico (MicroPython)
======================================================
Flash this as main.py onto the LED Pico via:
    mpremote connect /dev/pico-led cp main.py :main.py

Driven by pico_led_bridge.py on the host over USB serial.

LED PIN MAP
-----------
Individual LEDs:
  GP7  → Yellow   (status / activity)
  GP9  → Red      (error indicator)
  GP10 → Green    (bot online)
  GP15 → Network  (network connection status)
  GP16 → Yellow   (secondary status)
  GP17 → Red      (secondary error)
  GP19 → Blue     (processing / checking)
  GP20 → Green    (secondary online)

RGB Module (PWM):
  GP14 → Red channel
  GP12 → Green channel
  GP11 → Blue channel

COMMANDS (received as "LED:<MODE>\n" or bare "<MODE>\n")
---------
  OK        → Greens solid, Network LED SOLID (connected), RGB green
  CHECKING  → Blue breathing, Network LED SLOW BLINK (connecting), RGB cyan
  WARN      → Yellows blink, Network LED FAST BLINK (unstable), RGB amber
  ERROR     → Reds solid, Network LED VERY FAST BLINK (error), RGB red
  FAIL      → All fast blink, Network LED OFF (no connection), RGB red strobe
  SHUTDOWN  → All off
  TEST      → Cycle all LEDs one at a time

NETWORK LED (GP15)
------------------
  Solid ON        → Connected (OK)
  Slow blink      → Connecting / checking (CHECKING)
  Fast blink      → Degraded / unstable (WARN)
  Very fast blink → Connection error (ERROR)
  OFF             → No connection / critical failure (FAIL / SHUTDOWN)

Watchdog: if no command arrives within TIMEOUT_MS, enters FAIL mode.

RESPONSES to host:
  READY           → on boot
  ACK:<MODE>      → command accepted
  TEST:<LED>      → during test cycle
  PONG            → response to PING
"""

import sys
import utime
import select
import math
from machine import Pin, PWM

# ─── GPIO Setup ──────────────────────────────────────────────────────────────
# Individual LEDs
led_yellow1  = Pin(7,  Pin.OUT)   # GP7  yellow  (activity)
led_red1     = Pin(9,  Pin.OUT)   # GP9  red     (error)
led_green1   = Pin(10, Pin.OUT)   # GP10 green   (bot online)
led_network  = Pin(15, Pin.OUT)   # GP15 NETWORK LED — shows Wi-Fi/Discord connection
led_yellow2  = Pin(16, Pin.OUT)   # GP16 yellow  (secondary activity)
led_red2     = Pin(17, Pin.OUT)   # GP17 red     (secondary error)
led_blue     = Pin(19, Pin.OUT)   # GP19 blue    (processing)
led_green2   = Pin(20, Pin.OUT)   # GP20 green   (secondary online)

# RGB LED (PWM, active-high)
rgb_r = PWM(Pin(14)); rgb_r.freq(1000)
rgb_g = PWM(Pin(12)); rgb_g.freq(1000)
rgb_b = PWM(Pin(11)); rgb_b.freq(1000)

# Onboard LED (heartbeat)
led_onboard = Pin("LED", Pin.OUT)

# ─── LED Groups ──────────────────────────────────────────────────────────────
ALL_LEDS    = [led_yellow1, led_red1, led_green1, led_network,
               led_yellow2, led_red2, led_blue, led_green2]
GREEN_LEDS  = [led_green1, led_green2]
RED_LEDS    = [led_red1, led_red2]
YELLOW_LEDS = [led_yellow1, led_yellow2]

ALL_LEDS_NAMES = ["GP7-Yellow", "GP9-Red", "GP10-Green", "GP15-Network",
                  "GP16-Yellow", "GP17-Red", "GP19-Blue", "GP20-Green"]

# ─── Helpers ─────────────────────────────────────────────────────────────────
def rgb(r, g, b):
    """Set RGB LED. r/g/b = 0-255."""
    rgb_r.duty_u16(int(r / 255 * 65535))
    rgb_g.duty_u16(int(g / 255 * 65535))
    rgb_b.duty_u16(int(b / 255 * 65535))

def rgb_off():
    rgb_r.duty_u16(0)
    rgb_g.duty_u16(0)
    rgb_b.duty_u16(0)

def set_group(group, val):
    for led in group:
        led.value(val)

def all_off():
    for led in ALL_LEDS:
        led.off()
    rgb_off()
    led_onboard.off()

def brightness_curve(phase):
    """Smooth 0.0-1.0 breathing brightness from 0-1.0 phase."""
    return (math.sin(phase * math.pi * 2 - math.pi / 2) + 1) / 2

# ─── Startup animation ───────────────────────────────────────────────────────
def startup_animation():
    """Sweep each LED on/off, then do a quick RGB rainbow."""
    for led in ALL_LEDS:
        led.on()
        utime.sleep_ms(50)
        led.off()
    # RGB sweep: red → green → blue → off
    for v in range(0, 256, 8):
        rgb(v, 0, v)
        utime.sleep_ms(3)
    for v in range(255, -1, -8):
        rgb(v, 0, v)
        utime.sleep_ms(3)
    rgb_off()

# ─── Serial read (non-blocking, line-buffered) ───────────────────────────────
buf = ""
def read_cmd():
    global buf
    r, _, _ = select.select([sys.stdin], [], [], 0)
    if r:
        ch = sys.stdin.read(1)
        if ch in ('\n', '\r'):
            line = buf.strip().upper()
            buf = ""
            if line.startswith("LED:"):
                return line[4:]
            return line if line else None
        else:
            buf += ch
    return None

# ─── State ───────────────────────────────────────────────────────────────────
VALID_MODES  = {"OK", "CHECKING", "WARN", "ERROR", "FAIL", "SHUTDOWN", "TEST", "PING"}
TIMEOUT_MS   = 90000   # 90 s watchdog (bridge pings every ~5 s)
mode         = "CHECKING"
last_cmd_ms  = utime.ticks_ms()
tick         = 0        # incremented every 10 ms loop
phase        = 0.0      # breathing phase accumulator
test_idx     = 0
test_tick    = 0

# ─── Boot ────────────────────────────────────────────────────────────────────
startup_animation()
sys.stdout.write("READY\r\n")

# ─── Main loop (10 ms tick) ──────────────────────────────────────────────────
while True:
    now = utime.ticks_ms()

    # ── Serial command ───────────────────────────────────────────────────────
    cmd = read_cmd()
    if cmd and cmd in VALID_MODES:
        if cmd == "PING":
            last_cmd_ms = now  # PING resets the watchdog
            sys.stdout.write("PONG\r\n")
        else:
            prev_mode = mode
            mode = cmd
            last_cmd_ms = now
            tick = 0
            phase = 0.0
            test_idx = 0
            test_tick = 0
            all_off()
            sys.stdout.write("ACK:" + mode + "\r\n")

    # ── Watchdog ─────────────────────────────────────────────────────────────
    if mode not in ("SHUTDOWN",) and utime.ticks_diff(now, last_cmd_ms) > TIMEOUT_MS:
        if mode != "FAIL":
            mode = "FAIL"
            all_off()

    # ── Onboard LED heartbeat (fast blink while running) ─────────────────────
    led_onboard.value(1 if (tick // 50) % 2 == 0 else 0)

    # ── Mode rendering ───────────────────────────────────────────────────────

    if mode == "OK":
        # All good: greens solid, network LED solid (connected), RGB green
        set_group(GREEN_LEDS, 1)
        set_group(RED_LEDS, 0)
        set_group(YELLOW_LEDS, 0)
        led_blue.off()
        led_network.on()           # NETWORK: solid = connected
        rgb(0, 180, 60)

    elif mode == "CHECKING":
        # Connecting: blue breathing, network LED slow blink (trying to connect), RGB cyan
        set_group(GREEN_LEDS + RED_LEDS + YELLOW_LEDS, 0)
        bright = brightness_curve(phase)
        led_blue.value(1 if bright > 0.45 else 0)
        led_network.value((tick // 60) % 2)   # NETWORK: slow blink = connecting
        rgb(0, int(100 * bright), int(255 * bright))
        phase = (phase + 0.012) % 1.0

    elif mode == "WARN":
        # Degraded: yellows blink, network LED fast blink (unstable connection), RGB amber
        blink_slow = (tick // 40) % 2
        blink_fast = (tick // 15) % 2
        set_group(YELLOW_LEDS, blink_slow)
        set_group(GREEN_LEDS + RED_LEDS, 0)
        led_blue.off()
        led_network.value(blink_fast)  # NETWORK: fast blink = degraded/unstable
        rgb(int(200 * blink_slow), int(100 * blink_slow), 0)

    elif mode == "ERROR":
        # Error: reds solid, network LED very fast blink (connection error), RGB red breathing
        set_group(RED_LEDS, 1)
        set_group(GREEN_LEDS + YELLOW_LEDS, 0)
        led_blue.off()
        led_network.value((tick // 8) % 2)    # NETWORK: very fast blink = error
        bright = brightness_curve(phase)
        rgb(int(255 * (0.5 + 0.5 * bright)), 0, 0)
        phase = (phase + 0.008) % 1.0

    elif mode == "FAIL":
        # Critical: all R/Y/B fast blink, network LED off (no connection), RGB red strobe
        blink = (tick // 8) % 2
        set_group(RED_LEDS, blink)
        set_group(YELLOW_LEDS, blink)
        led_network.off()               # NETWORK: off = no connection
        led_blue.value(blink)
        set_group(GREEN_LEDS, 0)
        if blink:
            rgb(255, 0, 0)
        else:
            rgb_off()

    elif mode == "SHUTDOWN":
        all_off()

    elif mode == "TEST":
        # Step through every LED individually (20 ticks = 200 ms per step)
        TOTAL_STEPS = len(ALL_LEDS) + 3  # 8 individual + RGB R, G, B
        if test_tick == 0:
            all_off()
            if test_idx < len(ALL_LEDS):
                ALL_LEDS[test_idx].on()
                sys.stdout.write("TEST:" + ALL_LEDS_NAMES[test_idx] + "\r\n")
            elif test_idx == len(ALL_LEDS):
                rgb(255, 0, 0)
                sys.stdout.write("TEST:RGB_RED\r\n")
            elif test_idx == len(ALL_LEDS) + 1:
                rgb(0, 255, 0)
                sys.stdout.write("TEST:RGB_GREEN\r\n")
            elif test_idx == len(ALL_LEDS) + 2:
                rgb(0, 0, 255)
                sys.stdout.write("TEST:RGB_BLUE\r\n")
        test_tick += 1
        if test_tick >= 20:
            test_tick = 0
            test_idx = (test_idx + 1) % TOTAL_STEPS

    tick += 1
    utime.sleep_ms(10)
