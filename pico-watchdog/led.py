# =============================================================================
# led.py — RGB LED helper for Pico 2 W Watchdog
# =============================================================================
# Pins and common-cathode/anode flag are read from config.py so nothing is
# hardcoded here. Import this module from both boot.py and main.py.
#
# Wiring assumed: common-cathode RGB LED (active HIGH).
# If your LED is common-anode, set LED_COMMON_CATHODE = False in config.py.
# =============================================================================

from machine import Pin, PWM
import config

# Active-high (common cathode) or active-low (common anode)?
_ACTIVE_HIGH: bool = getattr(config, 'LED_COMMON_CATHODE', True)
_FULL = 65535 if _ACTIVE_HIGH else 0
_ZERO = 0     if _ACTIVE_HIGH else 65535

# Initialise PWM channels so brightness can be set 0–65535
_r = PWM(Pin(config.LED_PIN_RED));   _r.freq(1000)
_g = PWM(Pin(config.LED_PIN_GREEN)); _g.freq(1000)
_b = PWM(Pin(config.LED_PIN_BLUE));  _b.freq(1000)


def _set(r: int, g: int, b: int) -> None:
    """Set raw 16-bit duty for each channel (0 = off, 65535 = full)."""
    _r.duty_u16(r)
    _g.duty_u16(g)
    _b.duty_u16(b)


def _scaled(r: float, g: float, b: float) -> None:
    """Set channels by 0.0–1.0 fraction, honouring active-high/low."""
    def ch(v):
        duty = int(v * 65535)
        return duty if _ACTIVE_HIGH else (65535 - duty)
    _r.duty_u16(ch(r))
    _g.duty_u16(ch(g))
    _b.duty_u16(ch(b))


# ── Named states ──────────────────────────────────────────────────────────────

def off() -> None:
    """All LEDs off."""
    _r.duty_u16(_ZERO); _g.duty_u16(_ZERO); _b.duty_u16(_ZERO)

def blue() -> None:
    """Blue — booting / connecting to Wi-Fi."""
    _scaled(0, 0, 1.0)

def green() -> None:
    """Green — Pi 5 healthy, monitoring OK."""
    _scaled(0, 1.0, 0)

def amber() -> None:
    """Amber — 1 or 2 consecutive failures (warning)."""
    _scaled(1.0, 0.35, 0)

def red() -> None:
    """Red — Pi 5 DOWN, fallback server active."""
    _scaled(1.0, 0, 0)

def purple() -> None:
    """Purple — Wi-Fi lost, attempting reconnect."""
    _scaled(0.6, 0, 1.0)
