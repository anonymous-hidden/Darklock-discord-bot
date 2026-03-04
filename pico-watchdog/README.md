# Darklock — Pico 2 W Watchdog

A production-ready MicroPython watchdog and emergency fallback server for the Raspberry Pi 5.
Runs fully independently on a Raspberry Pi Pico 2 W on its own power supply.

## File Structure

```
pico-watchdog/
├── boot.py      Wi-Fi initialisation (runs first, automatically)
├── config.py    All credentials and settings — edit this file
└── main.py      Watchdog logic + emergency fallback server
```

---

## How It Works

```
Power on
  └─▶ boot.py — connect Wi-Fi
        └─▶ main.py — monitoring loop (every 10 s)
              │
              │  GET http://<PI5_IP>/health
              │  Header: X-Monitor-Token: <secret>
              │
              ├─▶  Response valid JSON { status:"ok" }
              │      → reset failure counter, log timestamp
              │
              └─▶  No response / bad JSON (× 3 consecutive)
                     → start emergency HTTP server on port 80
                     → serve static "Servers offline" page
                     → keep checking Pi 5 in background
                     → Pi 5 recovers → stop server, resume monitoring
```

---

## 1 — Flash MicroPython onto the Pico 2 W

> This only needs to be done once.

### Download the firmware

Go to: https://micropython.org/download/RPI_PICO2_W/

Download the latest `.uf2` for **Pico 2 W** (not the plain Pico 2).

### Flash it

1. Hold the **BOOTSEL** button on the Pico.
2. While holding BOOTSEL, plug the USB cable into your computer.
3. Release BOOTSEL. The Pico mounts as a USB mass-storage device called **RPI-RP2**.
4. Drag and drop (or copy) the `.uf2` file onto the **RPI-RP2** drive.
5. The Pico reboots automatically. The storage drive disappears — MicroPython is now running.

---

## 2 — Edit config.py

Open `config.py` and fill in your real values:

```python
WIFI_SSID     = "MyHomeNetwork"
WIFI_PASSWORD = "mypassword123"
PI5_IP        = "192.168.1.100"    # your Pi 5's LAN IP
MONITOR_TOKEN = "a-long-random-secret-string"
```

Generate a secure token:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

The same token must be accepted on the Pi 5 side.

---

## 3 — Upload Files to the Pico

Install the `mpremote` tool (recommended) or use **Thonny IDE**.

### Using mpremote (command line)

```bash
pip install mpremote

# Verify connection
mpremote connect auto ls

# Upload all three files
mpremote connect auto cp config.py :config.py
mpremote connect auto cp boot.py   :boot.py
mpremote connect auto cp main.py   :main.py
```

### Verify files are on the Pico

```bash
mpremote connect auto ls
# Should list: boot.py  config.py  main.py
```

### Using Thonny IDE

1. Open Thonny → **Tools → Options → Interpreter** → Set to "MicroPython (Raspberry Pi Pico)".
2. Open each file (`config.py`, `boot.py`, `main.py`) in Thonny.
3. **File → Save copy to MicroPython device** and save with the exact same filename.

---

## 4 — Test in REPL Before Running

```bash
mpremote connect auto repl
```

In the REPL:
```python
import config
print(config.PI5_IP)       # verify settings loaded
import boot                # manually run Wi-Fi setup
import main                # start watchdog (Ctrl+C to stop)
```

---

## 5 — Static IP (Recommended)

Assigning the Pico a fixed LAN address means it's always reachable for management
and its own fallback page is always at a predictable IP.

Un-comment and set in `config.py`:
```python
STATIC_IP      = "192.168.1.201"   # choose a free IP outside your DHCP range
STATIC_SUBNET  = "255.255.255.0"
STATIC_GATEWAY = "192.168.1.1"
STATIC_DNS     = "8.8.8.8"
```

Alternatively, reserve the address in your router's DHCP settings using the Pico's
MAC address (visible after first boot in the REPL: `import network; print(network.WLAN(0).config("mac"))`).

---

## 6 — Configure Pi 5's /health Endpoint

The Pi 5 must expose `GET /health` that:
- Returns HTTP 200
- Returns JSON with at minimum:

```json
{ "status": "ok", "uptime": "...", "timestamp": "2026-02-28T12:00:00Z" }
```

- Validates the `X-Monitor-Token` header against the shared secret
- Returns a non-200 status or no response if it rejects the token

For the existing Darklock server this endpoint already exists. Ensure it:
1. Is reachable at `http://<PI5_IP>/health` (or update config.py with the correct port)
2. Does **not** require auth cookies — only the header token

---

## 7 — Power Supply

For true independence, power the Pico 2 W from a source separate from the Pi 5:
- A dedicated USB charger on a different circuit
- A small UPS or power bank with pass-through charging
- PoE splitter on a separate switch port

The Pico draws ~40 mA at full load — any 5 V / 500 mA USB source is sufficient.

---

## 8 — Monitor Output (Optional)

If the Pico is USB-connected to a management machine, live log output can be read:

```bash
mpremote connect auto repl
# or
screen /dev/ttyACM0 115200
```

The watchdog prints a status line every heartbeat interval:

```
[watchdog] OK  ✓  Pi 5 healthy at 2026-02-28 14:22:05 UTC
[watchdog] FAIL (1/3)  Pi 5 did not respond.
[watchdog] FAIL (2/3)  Pi 5 did not respond.
[watchdog] FAIL (3/3)  Pi 5 did not respond.
[watchdog] Pi 5 marked DOWN — starting emergency server.
[server]   Emergency server listening on :80
[watchdog] Pi 5 is back ONLINE. Last heartbeat: 2026-02-28 14:25:15 UTC
[server]   Emergency server stopped.
```

---

## 9 — Troubleshooting

| Symptom | Check |
|---------|-------|
| Keeps failing Wi-Fi | Verify SSID/password in `config.py`; 2.4 GHz only (Pico W does not support 5 GHz) |
| Heartbeat always fails | Confirm `PI5_IP` and `PI5_PORT`; check Pi 5 firewall (`ufw allow 80`); verify `/health` returns 200 |
| 401 / 403 from Pi 5 | `MONITOR_TOKEN` mismatch between Pico and Pi 5 |
| Emergency server not reachable | Port 80 may be blocked on your router; try `FALLBACK_PORT = 8080` |
| Pico not running on reboot | Files must be named exactly `boot.py` and `main.py` at the root of the filesystem |

---

## Security Notes

- `config.py` contains credentials — **do not commit it to version control**. Add `config.py` to `.gitignore`.
- The fallback page exposes no internal data, no API, no forms.
- The monitoring token prevents any host from posing as a healthy Pi 5 to suppress the fallback page.
- The emergency server binds to `0.0.0.0` but only serves a single static page with no dynamic content.
