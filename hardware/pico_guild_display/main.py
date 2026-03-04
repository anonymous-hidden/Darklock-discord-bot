"""
DarkLock Guild Count Display — Raspberry Pi Pico
Displays Discord bot server count on 5461AS 4-digit 7-segment display.
Connected to Pi 5 via USB serial. Updates live when bot joins/leaves servers.

Wiring (5461AS is common-cathode):
  Segments A-G, DP → Pico GP2-GP9 through 220Ω resistors
  Digit select DIG1-4 → Pico GP10-GP13 (direct, no resistor)

Protocol: Receives "COUNT:1234\n" over USB serial @ 115200 baud
"""

import machine
import time
import sys

# ─── Pin Assignments ─────────────────────────────────────────────
SEGMENT_PINS = [2, 3, 4, 5, 6, 7, 8, 9]   # A B C D E F G DP
DIGIT_PINS   = [10, 11, 12, 13]            # DIG1 DIG2 DIG3 DIG4

# ─── Polarity ────────────────────────────────────────────────────
# For a bare common-cathode display wired directly to Pico GPIO:
#   Digit cathode LOW  = digit ON  → DIGIT_ON = 0
#   Digit cathode HIGH = digit OFF → DIGIT_OFF = 1
# If your digits are driven through NPN transistors (inverts signal):
#   swap the values below (DIGIT_ON=1, DIGIT_OFF=0)
DIGIT_ON  = 0
DIGIT_OFF = 1

# Segments are always HIGH = segment on (common anode of each segment)
SEG_ON  = 1
SEG_OFF = 0

# ─── Segment patterns (bit0=A … bit6=G, bit7=DP) ─────────────────
BLANK = 0b00000000
PATTERNS = [
    0b00111111,  # 0  — A B C D E F
    0b00000110,  # 1  — B C
    0b01011011,  # 2  — A B D E G
    0b01001111,  # 3  — A B C D G
    0b01100110,  # 4  — B C F G
    0b01101101,  # 5  — A C D F G
    0b01111101,  # 6  — A C D E F G
    0b00000111,  # 7  — A B C
    0b01111111,  # 8  — A B C D E F G
    0b01101111,  # 9  — A B C D F G
]


class GuildDisplay:
    def __init__(self):
        self.seg_pins = [machine.Pin(p, machine.Pin.OUT) for p in SEGMENT_PINS]
        self.dig_pins = [machine.Pin(p, machine.Pin.OUT) for p in DIGIT_PINS]
        self.value = 0
        self._all_off()
        print("[Pico] 7-Segment Display initialized")

    def _all_off(self):
        """Turn off every segment and every digit."""
        for p in self.seg_pins: p.value(SEG_OFF)
        for p in self.dig_pins: p.value(DIGIT_OFF)  # all cathodes inactive

    def _set_segments(self, pattern):
        for i, p in enumerate(self.seg_pins):
            p.value((pattern >> i) & 1)

    def _digit_patterns(self):
        """Return 4 patterns (leading-zero suppressed, ones always shown)."""
        d = [
            (self.value // 1000) % 10,
            (self.value // 100)  % 10,
            (self.value // 10)   % 10,
            self.value           % 10,
        ]
        pats = []
        blank = True
        for i, v in enumerate(d):
            if i == 3:
                blank = False   # ones position always shown
            if blank and v == 0:
                pats.append(BLANK)
            else:
                blank = False
                pats.append(PATTERNS[v])
        return pats

    def show_digit(self, pos):
        """Multiplex: show one digit position. Call in a fast loop."""
        pats = self._digit_patterns()

        # Step 1 — disable all digits (anti-ghosting)
        for p in self.dig_pins: p.value(DIGIT_OFF)

        # Step 2 — blank position: clear segments and leave digit off
        if pats[pos] == BLANK:
            self._set_segments(BLANK)
            return

        # Step 3 — load segments for this position
        self._set_segments(pats[pos])

        # Step 4 — enable this digit
        self.dig_pins[pos].value(DIGIT_ON)

    def set_count(self, count):
        self.value = max(0, min(9999, count))
        print(f"[Pico] Count: {self.value}")


def main():
    print("=" * 40)
    print("DarkLock Guild Count Display")
    print("Raspberry Pi Pico — 5461AS 7-Segment")
    print("=" * 40)

    display = GuildDisplay()

    # ── Boot test: show 8888 for 2 seconds ───────────────────────
    # If all 4 display positions light up → digit polarity is correct.
    # If only one lights or none → flip DIGIT_ON/DIGIT_OFF at the top.
    print("[Pico] Boot test: 8888")
    display.set_count(8888)
    start = time.ticks_ms()
    pos = 0
    while time.ticks_diff(time.ticks_ms(), start) < 2000:
        display.show_digit(pos)
        pos = (pos + 1) % 4
        time.sleep_us(2000)

    display.set_count(0)
    print("[Pico] Ready — send 'COUNT:N' to update")

    buf = ""
    pos = 0

    try:
        import select
        poll = select.poll()
        poll.register(sys.stdin, select.POLLIN)

        while True:
            events = poll.poll(0)
            if events:
                ch = sys.stdin.read(1)
                if ch:
                    if ch == '\n':
                        line = buf.strip()
                        if line.startswith("COUNT:"):
                            try:
                                display.set_count(int(line[6:]))
                            except ValueError:
                                pass
                        elif line == "PING":
                            sys.stdout.write("[Pico] PONG\r\n")
                        elif line == "RESET":
                            display.set_count(0)
                        buf = ""
                    else:
                        buf += ch

            display.show_digit(pos)
            pos = (pos + 1) % 4
            time.sleep_us(2000)

    except ImportError:
        while True:
            display.show_digit(pos)
            pos = (pos + 1) % 4
            time.sleep_us(2000)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[Pico] Stopped")
        d = GuildDisplay()
        d._all_off()
    except Exception as e:
        print(f"[Pico] Error: {e}")
        sys.print_exception(e)
