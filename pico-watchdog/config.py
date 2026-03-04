# =============================================================================
# config.py — Pico 2 W Watchdog Configuration
# =============================================================================
# Copy this file to your Pico as /config.py
# Keep this file off public version control — it contains credentials.
# =============================================================================

# ── Wi-Fi ────────────────────────────────────────────────────────────────────
WIFI_SSID     = "2.4gh network"
WIFI_PASSWORD = "OkPl*()6761"

# ── Target: Raspberry Pi 5 ───────────────────────────────────────────────────
PI5_IP   = "192.168.50.150"      # LAN IP of your Pi 5
PI5_PORT = 3002                    # Port the /health endpoint listens on

# ── Monitoring Token ─────────────────────────────────────────────────────────
# Sent as the X-Monitor-Token request header.
# Must match the expected value on the Pi 5 side.
MONITOR_TOKEN = "70d6610123dee310842ce4970d16c94989924fec9c52c668c0324d1b58c250be"

# ── Timing ───────────────────────────────────────────────────────────────────
HEARTBEAT_INTERVAL = 10          # Seconds between health checks
FAILURE_THRESHOLD  = 3           # Consecutive failures → Pi 5 marked DOWN
REQUEST_TIMEOUT    = 5           # Seconds to wait for a single HTTP response

# ── Emergency Server ─────────────────────────────────────────────────────────
FALLBACK_PORT = 80               # Port the Pico serves its fallback page on

# ── RGB LED ──────────────────────────────────────────────────────────────────
# Physical pin numbers for the RGB LED.
LED_PIN_RED   = 15
LED_PIN_GREEN = 14
LED_PIN_BLUE  = 6
# True  = common cathode (active HIGH — most common)
# False = common anode  (active LOW)
LED_COMMON_CATHODE = True

# ── WebREPL (remote access over Wi-Fi) ──────────────────────────────────────
# Connect with:  mpremote connect ws:192.168.50.200
# Or browser:    http://micropython.org/webrepl/  → ws://192.168.50.200:8266
WEBREPL_PASSWORD = "dlpico9"
WEBREPL_ENABLED  = True

# ── Static IP (optional) ─────────────────────────────────────────────────────
# Strongly recommended when using WebREPL so the Pico always has the same address.
STATIC_IP      = "192.168.50.200"   # Change to a free IP on your LAN
STATIC_SUBNET  = "255.255.255.0"
STATIC_GATEWAY = "192.168.50.1"
STATIC_DNS     = "8.8.8.8"
