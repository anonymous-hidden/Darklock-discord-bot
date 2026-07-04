import time
import machine
import ujson
import urandom
import uselect
import sys

from mfrc522 import MFRC522

DEVICE_ID = "pico2w-rfid-01"
HEARTBEAT_MS = 10000
ERROR_PATTERN_MS = 1200

SPI_ID = 0
PIN_SCK = 2
PIN_MOSI = 3
PIN_MISO = 4
PIN_CS = 5
PIN_RST = 6

PIN_GREEN = 13
PIN_BLUE = 14
PIN_RED = 15


def now_ms():
    return time.ticks_ms()


def safe_print_json(payload):
    try:
        sys.stdout.write(ujson.dumps(payload) + "\n")
    except Exception:
        pass


class LedController:
    def __init__(self):
        self.green = machine.Pin(PIN_GREEN, machine.Pin.OUT)
        self.blue = machine.Pin(PIN_BLUE, machine.Pin.OUT)
        self.red = machine.Pin(PIN_RED, machine.Pin.OUT)
        self.off()

    def off(self):
        self.green.value(0)
        self.blue.value(0)
        self.red.value(0)

    def ready(self):
        self.off()
        self.blue.value(1)

    def boot_blink(self, cycles=6, delay_ms=120):
        for _ in range(cycles):
            self.blue.value(1)
            time.sleep_ms(delay_ms)
            self.blue.value(0)
            time.sleep_ms(delay_ms)

    def accepted(self):
        self.off()
        for _ in range(2):
            self.green.value(1)
            time.sleep_ms(140)
            self.green.value(0)
            time.sleep_ms(100)
        self.ready()

    def rejected(self):
        self.off()
        for _ in range(2):
            self.red.value(1)
            time.sleep_ms(160)
            self.red.value(0)
            time.sleep_ms(110)
        self.ready()

    def command_ready(self):
        self.off()
        self.green.value(1)

    def error_pattern(self):
        end_at = time.ticks_add(now_ms(), ERROR_PATTERN_MS)
        state = 0
        while time.ticks_diff(end_at, now_ms()) > 0:
            state = 1 - state
            self.red.value(state)
            self.blue.value(1 - state)
            self.green.value(0)
            time.sleep_ms(140)
        self.ready()


class PicoRfidHub:
    def __init__(self):
        self.leds = LedController()
        self.start_ms = now_ms()
        self.last_heartbeat_ms = now_ms()
        self.last_scan_ms = 0
        self.pending_feedback_deadline = 0
        self.poller = uselect.poll()
        self.poller.register(sys.stdin, uselect.POLLIN)

        self.spi = machine.SPI(
            SPI_ID,
            baudrate=1000000,
            polarity=0,
            phase=0,
            sck=machine.Pin(PIN_SCK),
            mosi=machine.Pin(PIN_MOSI),
            miso=machine.Pin(PIN_MISO),
        )
        self.reader = MFRC522(self.spi, machine.Pin(PIN_RST), machine.Pin(PIN_CS))

    def uptime_ms(self):
        return time.ticks_diff(now_ms(), self.start_ms)

    def random_nonce(self):
        return "%08x" % urandom.getrandbits(32)

    def send_heartbeat_if_due(self):
        if time.ticks_diff(now_ms(), self.last_heartbeat_ms) < HEARTBEAT_MS:
            return
        self.last_heartbeat_ms = now_ms()
        safe_print_json({
            "type": "heartbeat",
            "deviceId": DEVICE_ID,
            "uptimeMs": self.uptime_ms()
        })

    def send_scan(self, uid_string):
        self.last_scan_ms = now_ms()
        self.pending_feedback_deadline = time.ticks_add(self.last_scan_ms, 3500)
        safe_print_json({
            "type": "rfid_scan",
            "deviceId": DEVICE_ID,
            "uid": uid_string,
            "timestampMs": self.uptime_ms(),
            "nonce": self.random_nonce()
        })

    def process_serial(self):
        events = self.poller.poll(0)
        if not events:
            return

        try:
            line = sys.stdin.readline()
        except Exception:
            return

        if not line:
            return

        line = line.strip()
        if not line:
            return

        try:
            msg = ujson.loads(line)
        except Exception:
            return

        if not isinstance(msg, dict):
            return

        if msg.get("type") != "led":
            return

        state = str(msg.get("state", "")).strip().lower()
        if state == "accepted":
            self.pending_feedback_deadline = 0
            self.leds.accepted()
        elif state == "rejected":
            self.pending_feedback_deadline = 0
            self.leds.rejected()
        elif state == "ready":
            self.pending_feedback_deadline = 0
            self.leds.command_ready()

    def check_feedback_timeout(self):
        if self.pending_feedback_deadline == 0:
            return

        if time.ticks_diff(self.pending_feedback_deadline, now_ms()) <= 0:
            self.pending_feedback_deadline = 0
            self.leds.error_pattern()

    def read_card_uid(self):
        status, _ = self.reader.request(self.reader.REQIDL)
        if status != self.reader.OK:
            return None

        status, raw_uid = self.reader.anticoll()
        if status != self.reader.OK or not raw_uid:
            return None

        return "".join(["%02X" % b for b in raw_uid])

    def run(self):
        self.leds.boot_blink()
        self.leds.ready()

        safe_print_json({
            "type": "heartbeat",
            "deviceId": DEVICE_ID,
            "uptimeMs": self.uptime_ms()
        })

        while True:
            self.process_serial()
            self.send_heartbeat_if_due()
            self.check_feedback_timeout()

            uid = self.read_card_uid()
            if uid:
                self.send_scan(uid)
                time.sleep_ms(350)

            time.sleep_ms(50)


hub = PicoRfidHub()
hub.run()
