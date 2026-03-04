# DarkLock Hardware Pin Reference

> Complete audit of every hardware pin, peripheral, and connection across all
> boards in the DarkLock system. Last updated: 2026-03-03.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Raspberry Pi 5  (darklock@192.168.50.150)                       │
│  ─ Runs Discord bot (src/bot.js), Darklock platform              │
│    (darklock/start.js), hardware controller, RFID gateway        │
│                                                                   │
│  USB Serial ──►  Elegoo Mega 2560   (/dev/elegoo)                │
│  USB Serial ──►  Pico Guild Display (/dev/ttyACM*)               │
│  USB Serial ──►  Pico LED Module    (/dev/pico-led)               │
│  USB CDC    ──►  Pico W Portable    (/dev/ttyACM*)               │
│  SPI0       ──►  RC522 RFID Reader  (GPIO 8–11, RST GPIO25)      │
│  GPIO BCM   ──►  RGB LED (direct)   (GPIO 17, 22, 27)            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Raspberry Pi Pico 2 W  (192.168.50.200 — Wi-Fi watchdog)        │
│  ─ Standalone watchdog: monitors Pi5 health over HTTP             │
│  ─ Serves emergency fallback web page if Pi5 goes down            │
│  ─ RGB LED status indicator, WebREPL enabled                      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Raspberry Pi Pico W  (USB portable — "Pico Portable")           │
│  ─ 4 single-colour LEDs driven over USB serial from Pi5          │
│  ─ Firmware: pico_portable_status.py                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1. Raspberry Pi 5

Connected devices: `darklock@192.168.50.150`

### SPI Bus — RC522 RFID (`hardware/rfid_gateway.py`)

| Function | BCM | Physical |
|----------|-----|----------|
| RFID SS / SDA | GPIO 8 (CE0) | Pin 24 |
| RFID MISO | GPIO 9 | Pin 21 |
| RFID MOSI | GPIO 10 | Pin 19 |
| RFID SCLK | GPIO 11 | Pin 23 |
| RFID RST | GPIO 25 | Pin 22 |

### RGB Status LED — Server Health (`rgb_led_status.py`)

| Color | BCM | Physical |
|-------|-----|----------|
| Red | GPIO 17 | Pin 11 |
| Green | GPIO 27 | Pin 13 |
| Blue | GPIO 22 | Pin 15 |

PWM Frequency: 1000 Hz

| Color | Meaning |
|-------|---------|
| Green | Server / bot live |
| Blue | Restarting |
| Red | Down / error |

### USB Devices

| Device | Path | Speed |
|--------|------|-------|
| Elegoo Mega | `/dev/elegoo` | 115200 |
| Pico LED Module | `/dev/pico-led` | 115200 |
| Pico Guild Display | `/dev/ttyACM*` | 115200 |
| Pico Portable | `/dev/ttyACM*` | CDC |

---

## 2. Elegoo Mega 2560

Connected via USB serial at **115200 baud** (`/dev/elegoo` or `/dev/ttyACM0`).
Dumb display terminal — all security logic runs on the Pi 5.

### LCD 16×2 (4-bit mode)

| Mega Pin | LCD Pin | Function |
|----------|---------|----------|
| D7 | 4 | RS |
| D8 | 6 | EN |
| D9 | 11 | D4 |
| D10 | 12 | D5 |
| D11 | 13 | D6 |
| D12 | 14 | D7 |

LCD pins 1=GND, 2=VCC, 3=Contrast, 5=GND (R/W tied low), 7–10=NC (4-bit mode), 15=VCC backlight, 16=GND backlight.

### RGB LED 1 — Bot Status

| Mega Pin | Color |
|----------|-------|
| D29 | Red |
| D31 | Green |
| D33 | Blue |

| Color | Meaning |
|-------|---------|
| Green | Bot online & healthy |
| Red | Bot offline / error |
| Blue | Bot starting / processing |

### RGB LED 2 — System Status

| Mega Pin | Color |
|----------|-------|
| D23 | Red |
| D25 | Green |
| D27 | Blue |

| Color | Meaning |
|-------|---------|
| Green | All clear / healthy |
| Red | Critical error / tamper active |
| Blue | Processing / waiting |
| Purple | System alert |

### Security Indicators

| Mega Pin | Device | Meaning |
|----------|--------|---------|
| D32 | Tamper LED (Red) | HIGH = tamper violation detected |
| D28 | RFID LED Green | Access granted / valid card |
| D30 | RFID LED Red | Access denied / invalid card |

### MAX7219 Matrix

| Mega Pin | Function |
|----------|----------|
| D22 | DIN |
| D24 | CS |
| D26 | CLK |

| Command | Pattern | Meaning |
|---------|---------|---------|
| `MATRIX_IDLE` | Radar sweep | Normal idle |
| `MATRIX_SCAN` | Row scan | RFID scanning |
| `MATRIX_OK` | Checkmark ✓ | Access granted (2 s) |
| `MATRIX_DENIED` | X mark ✗ | Access denied (2 s) |
| `MATRIX_ALERT` | Full flash | Intrusion / tamper (4 s) |
| `MATRIX_LOCK` | Lock icon 🔒 | System locked |
| `MATRIX_BOOT` | Boot animation | Startup only |

### SPI Pins (Test Only — `rfid_test.ino`)

| Mega Pin | Function |
|----------|----------|
| D50 | MISO |
| D51 | MOSI |
| D52 | SCK |
| D53 | SS |

### Serial Protocol (115200 baud, `\n` delimited)

**Pi → Mega:**
```
LCD:line1|line2      Update LCD (max 16 chars per line)
LED1:r,g,b           RGB LED 1 (0-255, threshold 128)
LED2:r,g,b           RGB LED 2
TAMPER:0/1           Tamper LED off/on
RFID:GREEN/RED/OFF   RFID indicator LEDs
PING                 Heartbeat
CLEAR                Clear LCD
MATRIX_SCAN/OK/DENIED/ALERT/IDLE/LOCK/BOOT
```

**Mega → Pi:**
```
READY                Boot complete
PONG                 Heartbeat reply
ACK:<cmd>            Command acknowledged
```

### Arduino Sketches (`hardware/`)

| Sketch | Purpose |
|--------|---------|
| `darklock_security_gate/darklock_security_gate.ino` | **Production** — Full controller (LCD + LEDs + Matrix + RFID LEDs) |
| `elegoo_guild_display/elegoo_combined.ino` | Combined controller (LCD + LEDs + Matrix) |
| `darklock_display/darklock_display.ino` | Simplified (LCD + LEDs only) |
| `elegoo_guild_display/pin_diagnostic.ino` | Pin-by-pin test utility |
| `max7219_test/max7219_test.ino` | MAX7219 dot matrix test |
| `rfid_test/rfid_test.ino` | RC522 RFID scanner test (hardware SPI) |
| `guild_count_display/guild_count_display.ino` | Legacy 7-seg wiring on Mega (replaced by Pico) |

---

## 3. Pico — Guild Display

Firmware: `hardware/pico_guild_display/main.py` · USB serial 115200 baud

### 7-Segment 5461AS (Common Cathode)

#### Segment Pins (220 Ω resistors, active HIGH)

| Segment | Pico |
|---------|------|
| A | GP2 |
| B | GP3 |
| C | GP4 |
| D | GP5 |
| E | GP6 |
| F | GP7 |
| G | GP8 |
| DP | GP9 |

#### Digit Select Pins (direct, no resistor)

| Digit | Pico | Position |
|-------|------|----------|
| DIG1 | GP10 | Thousands |
| DIG2 | GP11 | Hundreds |
| DIG3 | GP12 | Tens |
| DIG4 | GP13 | Ones |

Multiplexing: ~125 Hz (2 ms per digit × 4 digits)

```
         ── A ──
        |       |
        F       B
        |       |
         ── G ──
        |       |
        E       C
        |       |
         ── D ──  . DP
```

### Serial Protocol

| Command | Action |
|---------|--------|
| `COUNT:1234` | Set display to 1234 (range 0–9999) |
| `PING` | Heartbeat → responds `PONG` |
| `RESET` | Clear display to 0000 |

---

## 4. Pico W — Portable Status

Firmware: `pico_portable_status.py` · USB CDC · Driven by `pico-bridge.js`

### 4 LED System

| Pico Pin | LED |
|----------|-----|
| GP19 | Blue |
| GP20 | Green |
| GP21 | Red |
| GP22 | Yellow |

All pins: `Pin.OUT` digital

### LED States

| State | Pattern |
|-------|---------|
| `OK` | Green solid |
| `CHECKING` | Blue slow pulse (500 ms, 50% duty) |
| `DEGRADED` | Yellow slow blink (667 ms on / 333 ms off) |
| `FAIL` | Red fast blink (250 ms) |
| `NO_SIGNAL` | Blue slow pulse (fallback after 15 s) |
| `SHUTDOWN` | All off |

**Host → Pico:** `OK`, `CHECKING`, `DEGRADED`, `FAIL`, `SHUTDOWN`, `PING`
**Pico → Host:** `PONG`, `CMD: <state>`

Watchdog timeout: **15 000 ms** — enters `NO_SIGNAL` if no command received.

---

## 5. Pico — LED Module

Firmware: `hardware/pico_led_module/main.py` · `/dev/pico-led` · Driven by `pico_led_bridge.py`

### Individual LEDs

| Pico Pin | LED |
|----------|-----|
| GP7 | Yellow |
| GP9 | Red |
| GP10 | Green |
| GP15 | **Network** |
| GP16 | Yellow |
| GP17 | Red |
| GP19 | Blue |
| GP20 | Green |

All pins: `Pin.OUT` digital

### RGB LED (PWM)

| Pico Pin | Color |
|----------|-------|
| GP14 | Red |
| GP12 | Green |
| GP11 | Blue |

PWM: 1000 Hz, 16-bit duty (0–65535), active HIGH (common cathode)

### Onboard LED

| Pin | Purpose |
|-----|---------|
| `LED` | Heartbeat |

### LED States

| State | Individual LEDs | Network LED (GP15) | RGB |
|-------|----------------|-------------------|-----|
| `OK` | Greens solid (GP10, GP20) | **Solid ON** — connected | Green |
| `CHECKING` | Blue breathing (GP19) | Slow blink — connecting | Cyan |
| `WARN` | Yellows fast blink (GP7, GP16) | Fast blink — unstable | Amber |
| `ERROR` | Reds solid (GP9, GP17) | Very fast blink — error | Red |
| `FAIL` | All fast blink | **OFF** — no connection | Red strobe |
| `SHUTDOWN` | All off | Off | Off |
| `TEST` | Cycle each LED | Cycles with others | Rainbow |

---

## 6. Pico 2 W — Watchdog

Firmware: `pico-watchdog/` · Wi-Fi Monitor Node · IP: **192.168.50.200**

### RGB LED

| Pico Pin | Color |
|----------|-------|
| GP15 | Red |
| GP14 | Green |
| GP6 | Blue |

PWM: 1000 Hz, 16-bit duty. Common cathode (active HIGH). Set via `LED_COMMON_CATHODE` in `config.py`.

| Color | Meaning |
|-------|---------|
| Blue | Booting / connecting to Wi-Fi |
| Green | Pi 5 healthy |
| Amber | 1–2 consecutive failures (warning) |
| Red | Pi 5 DOWN, fallback server active |
| Purple | Wi-Fi lost, reconnecting |

### Network Settings

| Setting | Value |
|---------|-------|
| SSID | `2.4gh network` |
| Static IP | `192.168.50.200` |
| Subnet | `255.255.255.0` |
| Gateway | `192.168.50.1` |
| DNS | `8.8.8.8` |
| Pi Target | `192.168.50.150:3002` |
| Check Interval | 10 s |
| Fail Threshold | 3 |
| Request Timeout | 5 s |
| Fallback Port | 80 |
| WebREPL | Port 8266, password `dlpico9` |

---

## 7. Legacy Pico — ESP8266 AT Bridge

Files: `config.py`, `network.py`, `main.py`, `state.py` in project root.
For non-W Pico boards without built-in Wi-Fi.

### UART Bridge

| Pico Pin | Function |
|----------|----------|
| GP0 | TX → ESP8266 RX (UART0, 115200 baud) |
| GP1 | RX ← ESP8266 TX |
| GP14 | OK LED (Green) |
| GP15 | FAIL LED (Red) |

| State | GP14 (OK) | GP15 (FAIL) |
|-------|-----------|-------------|
| Healthy | HIGH | LOW |
| Degraded | Blink 150 ms | LOW |
| Failed | LOW | HIGH |

---

## 8. Conflict Check

The same GP numbers appear on different Pico boards. This is intentional —
each board is a **separate physical device** with no shared wiring.

| Pin | Used On |
|-----|---------|
| GP19 | Pico LED Module (Blue LED) + Pico W Portable (Blue LED) |
| GP20 | Pico LED Module (Green LED) + Pico W Portable (Green LED) |
| GP14 | Pico LED Module (RGB Red PWM) + Pico 2 W Watchdog (RGB Green PWM) + Legacy Pico (OK LED) |
| GP15 | Pico LED Module (White LED) + Pico 2 W Watchdog (RGB Red PWM) + Legacy Pico (FAIL LED) |
| GP6 | Pico Guild Display (Segment E) + Pico 2 W Watchdog (RGB Blue PWM) |

No electrical conflicts exist — these are separate microcontrollers.

---

## 9. Communication Bus Diagram

```
                          ┌─────────────┐
                          │  Pi 5 SPI0  │
                          │  GPIO 8-11  │──── RC522 RFID Reader
                          │  GPIO 25    │──── RC522 RST
                          │             │
                          │  GPIO 17    │──── RGB LED Red (PWM)
                          │  GPIO 27    │──── RGB LED Green (PWM)
                          │  GPIO 22    │──── RGB LED Blue (PWM)
                          │             │
                 USB ─────│ /dev/elegoo │──── Elegoo Mega 2560
               Serial     │             │       ├── LCD 16×2
              115200       │             │       ├── RGB LED 1 (Bot Status)
                          │             │       ├── RGB LED 2 (System Status)
                          │             │       ├── Tamper LED
                          │             │       ├── RFID LEDs (G+R)
                          │             │       └── MAX7219 8×8 Matrix
                          │             │
                 USB ─────│ /dev/ttyACM*│──── Pico (Guild Count 7-Seg)
               Serial     │             │       └── 5461AS 4-digit display
              115200       │             │
                          │             │
                 USB ─────│ /dev/pico-led│──── Pico (LED Module)
               Serial     │             │       ├── 8× Individual LEDs
              115200       │             │       └── RGB LED (PWM)
                          │             │
                 USB ─────│ /dev/ttyACM*│──── Pico W (Portable Status)
               CDC        │             │       └── 4× Status LEDs (R/G/B/Y)
                          └─────────────┘

              Wi-Fi  ─────────────────────────── Pico 2 W (Watchdog)
           192.168.50.200                          ├── RGB LED (PWM)
                                                   └── HTTP fallback server :80
```

---

## 10. Source File Index

| File | Board | Purpose |
|------|-------|---------|
| `hardware_controller.py` | Pi 5 | Bridges bot status → Elegoo serial commands |
| `rgb_led_status.py` | Pi 5 | Direct GPIO RGB LED monitor (BCM 17/27/22) |
| `hardware/rfid_gateway.py` | Pi 5 | SPI RC522 RFID + Elegoo display integration |
| `hardware/arduino_bridge.py` | Pi 5 | Alternative Elegoo serial bridge |
| `pico_led_bridge.py` | Pi 5 | Host bridge for Pico LED module |
| `pico-bridge.js` | Pi 5 | Host bridge for Pico portable LEDs |
| `hardware/darklock_security_gate/darklock_security_gate.ino` | Mega 2560 | **Production** — Full controller |
| `hardware/elegoo_guild_display/elegoo_combined.ino` | Mega 2560 | Combined controller |
| `hardware/darklock_display/darklock_display.ino` | Mega 2560 | Simplified LCD + LED controller |
| `hardware/elegoo_guild_display/pin_diagnostic.ino` | Mega 2560 | Pin test utility |
| `hardware/pico_guild_display/main.py` | Pico | 7-segment guild count firmware |
| `pico_7segment_display.py` | Pico | Copy of guild display firmware |
| `pico_portable_status.py` | Pico W | Portable 4-LED status firmware |
| `hardware/pico_led_module/main.py` | Pico | 8-LED + RGB module firmware |
| `pico-watchdog/main.py` | Pico 2 W | Wi-Fi watchdog + emergency server |
| `pico-watchdog/config.py` | Pico 2 W | Watchdog network/pin configuration |
| `pico-watchdog/led.py` | Pico 2 W | RGB LED helper |
| `pico-watchdog/boot.py` | Pico 2 W | Wi-Fi init (runs before main.py) |
| `config.py` | Pico (legacy) | ESP8266 AT watchdog config |
| `main.py` | Pico (legacy) | ESP8266 AT watchdog main loop |
| `network.py` | Pico (legacy) | ESP8266 AT UART network driver |
| `state.py` | Pico (legacy) | Watchdog state machine |
