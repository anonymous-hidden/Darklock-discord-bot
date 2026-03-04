# DarkLock Hardware Pin Reference

**Last Updated:** February 17, 2026

---

## Elegoo Mega 2560 Pins

### RGB LEDs (Digital On/Off)

**RGB-LED 1 (Bot Status):**
- Red: **D29**
- Green: **D31**
- Blue: **D33**

**RGB-LED 2 (Secondary Status):**
- Red: **D23**
- Green: **D25**
- Blue: **D27**

### Status LEDs

**Tamper Detection Shutdown:**
- Red: **D32**

**RFID Scanner:**
- Green: **D28**
- Red: **D30**

### LCD 16×2 (4-bit mode)

Uses PWM pins as digital:
- RS: **P7**
- EN: **P8**
- D4: **P9**
- D5: **P10**
- D6: **P11**
- D7: **P12**

### MAX7219 8×8 Dot Matrix

Software SPI:
- DIN: **D22**
- CS: **D24**
- CLK: **D26**

---

## Raspberry Pi Pico Pins

### 5461AS 7-Segment Display (Common Cathode)

**Segments (with 220Ω resistors):**
- A: **GP2**
- B: **GP3**
- C: **GP4**
- D: **GP5**
- E: **GP6**
- F: **GP7**
- G: **GP8**
- DP: **GP9**

**Digit Select (direct, no resistor):**
- DIG1: **GP10**
- DIG2: **GP11**
- DIG3: **GP12**
- DIG4: **GP13**

---

## Upload Instructions

### Elegoo Mega 2560

**Recommended sketch:** `hardware/elegoo_guild_display/elegoo_combined.ino`

Arduino IDE:
1. Open `.ino` file
2. Board: "Arduino Mega or Mega 2560"
3. Port: `/dev/ttyACM0`
4. Upload

### Raspberry Pi Pico

**Firmware:** `hardware/pico_guild_display/main.py`

```bash
pip3 install adafruit-ampy
ampy --port /dev/ttyACM0 put hardware/pico_guild_display/main.py /main.py
```

---

## Files Overview

| File | Purpose |
|------|---------|
| `hardware/darklock_security_gate/darklock_security_gate.ino` | Full-featured Elegoo sketch with all animations |
| `hardware/elegoo_guild_display/elegoo_combined.ino` | LCD + RGB + Tamper + RFID + Matrix control |
| `hardware/elegoo_guild_display/pin_diagnostic.ino` | Tests each pin one by one |
| `hardware/max7219_test/max7219_test.ino` | MAX7219 matrix test patterns |
| `hardware/pico_guild_display/main.py` | Pico 7-segment display firmware |
| `hardware/elegoo_guild_display/elegoo_bridge.py` | Pi→Elegoo serial bridge |
| `hardware/pico_guild_display/pico_bridge.py` | Pi→Pico serial bridge |
| `hardware_controller.py` | Main hardware controller (combines both) |

---

## Serial Protocol

**Elegoo (115200 baud):**
- `LCD:line1|line2`
- `LED1:r,g,b` / `LED2:r,g,b`
- `TAMPER:0/1`
- `RFID:GREEN/RED/OFF`
- `MATRIX_SCAN/OK/DENIED/ALERT/IDLE/LOCK/BOOT`
- `PING` / `CLEAR`

**Pico (115200 baud):**
- `COUNT:1234` (guild count 0-9999)
- `PING`
- `RESET`

---

**See Pi5:** `/home/darklock/discord-bot/HARDWARE_SETUP.md` for full setup guide
**Wiring:** `hardware/pico_guild_display/WIRING.txt` for detailed wiring diagrams
