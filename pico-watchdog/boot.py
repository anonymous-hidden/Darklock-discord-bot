# =============================================================================
# boot.py — Wi-Fi initialisation (runs automatically before main.py)
# =============================================================================
# MicroPython executes boot.py at power-on before main.py.
# Keeps all credential logic isolated from the main watchdog loop.
# =============================================================================

import network
import time
import sys

# ── Interrupt window ──────────────────────────────────────────────────────────
# Note: LED is NOT initialised here because led.py imports config, and config
# is validated below. LED state is set after a successful import of config.
# Give mpremote / Thonny 2 seconds to send Ctrl+C before the Wi-Fi loop starts.
# Without this, the serial output from connect_wifi() prevents mpremote from
# entering raw REPL mode (TransportError: could not enter raw repl).
time.sleep(2)

# Import credentials from the separate config file — never hardcode here.
try:
    import config
except ImportError:
    print("[boot] FATAL: config.py not found on Pico. Upload config.py first.")
    sys.exit(1)

# Initialise LED — blue while connecting to Wi-Fi
try:
    import led as _led
    _led.blue()
except Exception as _e:
    print("[boot] LED init failed (non-fatal):", _e)
    _led = None


def connect_wifi(retries: int = 5, retry_delay: int = 5) -> bool:
    """
    Bring up the STA (station) interface and connect to Wi-Fi.

    If STATIC_IP is set in config.py, configure a fixed LAN address before
    connecting so the Pico always has the same IP regardless of DHCP leases.

    Returns True on success, False if all retries are exhausted.
    The caller (main.py) must handle the False case gracefully.
    """
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    # ── Optional static IP ────────────────────────────────────────────────────
    # Must be applied BEFORE calling wlan.connect(); some firmware versions
    # reset ifconfig on connect otherwise.
    if config.STATIC_IP:
        wlan.ifconfig((
            config.STATIC_IP,
            config.STATIC_SUBNET,
            config.STATIC_GATEWAY,
            config.STATIC_DNS,
        ))
        print("[boot] Static IP configured:", config.STATIC_IP)

    # ── Already connected (e.g. soft-reboot) ─────────────────────────────────
    if wlan.isconnected():
        print("[boot] Already connected:", wlan.ifconfig()[0])
        return True

    # ── Connect with retry loop ───────────────────────────────────────────────
    for attempt in range(1, retries + 1):
        print(f"[boot] Connecting to '{config.WIFI_SSID}' (attempt {attempt}/{retries})...")
        wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)

        # Wait up to 20 s for association
        deadline = 20
        while not wlan.isconnected() and deadline > 0:
            time.sleep(1)
            deadline -= 1
            print(".", end="")
        print()

        if wlan.isconnected():
            ip, subnet, gateway, dns = wlan.ifconfig()
            print(f"[boot] Connected  |  IP: {ip}  GW: {gateway}")
            if _led:
                _led.green()   # Connected → handoff to main.py which will set final state
            return True

        # Back off before retrying
        if attempt < retries:
            print(f"[boot] Failed. Retrying in {retry_delay}s...")
            wlan.disconnect()
            time.sleep(retry_delay)

    print("[boot] WARNING: Could not connect to Wi-Fi after all retries.")
    print("[boot] main.py will re-attempt Wi-Fi before each monitoring cycle.")
    return False


# Run immediately when the Pico boots
connected = connect_wifi()
# WebREPL is started from main.py inside the asyncio event loop.
