# Pico 2 W RFID Hub Firmware

This firmware runs on a Raspberry Pi Pico 2 W (MicroPython) and communicates with DarkLock over USB serial.

## Wiring

### RC522 -> Pico 2 W
- SDA/SS -> GP5 (pin 7)
- SCK -> GP2 (pin 4)
- MOSI -> GP3 (pin 5)
- MISO -> GP4 (pin 6)
- RST -> GP6 (pin 9)
- 3.3V -> 3V3 OUT (pin 36)
- GND -> GND (pin 38)

### LEDs -> Pico 2 W
- Green LED -> GP13 (pin 17)
- Blue LED -> GP14 (pin 19)
- Red LED -> GP15 (pin 20)

## Serial protocol

### Pico -> Server JSON lines
- Heartbeat every 10s:
```json
{"type":"heartbeat","deviceId":"pico2w-rfid-01","uptimeMs":12345}
```

- RFID scan:
```json
{"type":"rfid_scan","deviceId":"pico2w-rfid-01","uid":"DEADBEEF","timestampMs":12345,"nonce":"a1b2c3d4"}
```

### Server -> Pico JSON lines
- Accepted LED:
```json
{"type":"led","state":"accepted"}
```

- Rejected LED:
```json
{"type":"led","state":"rejected"}
```

- Ready LED:
```json
{"type":"led","state":"ready"}
```

## Install

From project root:

```bash
npm run pico:install
```

This copies `main.py` and `mfrc522.py` to the Pico over USB using `mpremote`.
