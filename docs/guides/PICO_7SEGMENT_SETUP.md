# Pico 7-Segment Server Counter Setup Guide

This guide will help you set up a 4-digit 7-segment display (5461AS) connected to a Raspberry Pi Pico to show your Discord bot's server count in real-time.

## Hardware Requirements

- **Raspberry Pi 5** (running the Discord bot)
- **Raspberry Pi Pico** (with MicroPython installed)
- **5461AS 4-Digit 7-Segment Display** (Common Cathode)
- **USB Cable** (to connect Pico to Pi5)
- **Jumper Wires** (to connect display to Pico)
- **Optional:** 4x 220Ω resistors (one per digit for current limiting)

## Wiring Diagram

### Pico to 5461AS Connections

The 5461AS has 12 pins (6 on each side). Numbering from top-left:

```
    ┌─────────────┐
 11 │●           ●│ 12  (D1)
  7 │●           ●│  9  (D2)
  4 │●           ●│  8  (D3)
  2 │●     5     ●│  6  (D4)
  1 │●    4 6    ●│ 10
  5 │●   1 A S   ●│  3
    └─────────────┘
```

### Pin Mapping

| Display Pin | Function | Pico GPIO | Wire Color Suggestion |
|-------------|----------|-----------|----------------------|
| Pin 12 | D1 (Digit 1) | GPIO 9 | Red |
| Pin 9 | D2 (Digit 2) | GPIO 12 | Orange |
| Pin 8 | D3 (Digit 3) | GPIO 14 | Yellow |
| Pin 6 | D4 (Digit 4) | GPIO 7 | Green |
| Pin 11 | Segment A | GPIO 10 | Blue |
| Pin 7 | Segment B | GPIO 15 | Purple |
| Pin 4 | Segment C | GPIO 5 | Gray |
| Pin 2 | Segment D | GPIO 2 | White |
| Pin 1 | Segment E | GPIO 1 | Brown |
| Pin 10 | Segment F | GPIO 11 | Black |
| Pin 5 | Segment G | GPIO 6 | Pink |
| Pin 3 | Decimal Point | GPIO 4 | (Optional) |

### Pico GPIO Physical Pin Reference

For reference, here are the physical pin numbers on the Pico:

- GPIO 1 = Physical Pin 2
- GPIO 2 = Physical Pin 4
- GPIO 4 = Physical Pin 6
- GPIO 5 = Physical Pin 7
- GPIO 6 = Physical Pin 9
- GPIO 7 = Physical Pin 10
- GPIO 9 = Physical Pin 12
- GPIO 10 = Physical Pin 14
- GPIO 11 = Physical Pin 15
- GPIO 12 = Physical Pin 16
- GPIO 14 = Physical Pin 19
- GPIO 15 = Physical Pin 20

**Important:** Also connect **GND** from the Pico (any GND pin) to **ALL** common cathode pins on your display if using common cathode configuration.

## Software Setup

### Step 1: Install MicroPython on Pico

1. Download the latest MicroPython UF2 file from: https://micropython.org/download/rp2-pico/
2. Hold the **BOOTSEL** button on your Pico while plugging it into your Pi5 via USB
3. The Pico will appear as a USB mass storage device
4. Copy the `.uf2` file to the Pico drive
5. The Pico will automatically reboot with MicroPython installed

### Step 2: Deploy the Display Code

On your Raspberry Pi 5, run:

```bash
cd "/home/cayden/discord bot/discord bot"
./deploy-pico-7segment.sh
```

This script will:
- Install `mpremote` if needed (tool to communicate with MicroPython devices)
- Detect your Pico
- Upload the display code
- Configure it to run automatically on boot

### Step 3: Configure the Discord Bot

Add or update this line in your `.env` file:

```bash
SEGMENT_PORT=/dev/ttyACM0
```

**Note:** The device path might be different. Check with:
```bash
ls /dev/ttyACM* /dev/ttyUSB*
```

The bot already has integration code in `src/hardware/guildCounterDisplay.js` that will automatically send updates to the display.

### Step 4: Test the Display

After deployment, the display should:
1. Show a counting animation (0-9) on startup
2. Flash "0000" a few times
3. Wait for count updates from the bot

To manually test:

```bash
# View Pico output
mpremote connect /dev/ttyACM0

# Send a test count (in another terminal)
echo 'COUNT:1234' > /dev/ttyACM0
```

### Step 5: Start/Restart the Bot

```bash
npm start
```

The display should now show your bot's current server count and update automatically when:
- The bot joins a new server
- The bot leaves a server  
- Every 5 minutes (automatic refresh)

## Troubleshooting

### Display shows all zeros

- Check that the bot is running and connected
- Verify `SEGMENT_PORT` in `.env` matches your Pico's device path
- Check USB connection between Pi5 and Pico
- Use `mpremote connect /dev/ttyACM0` to see Pico's debug output

### Display is dim or flickering

- This is normal multiplexing behavior at low refresh rates
- The current code uses a 125Hz refresh rate (2ms per digit)
- Add current-limiting resistors (220Ω) if segments are too bright

### Wrong device path error

Check available serial devices:
```bash
ls -l /dev/ttyACM* /dev/ttyUSB*
```

If you get permission denied:
```bash
sudo usermod -a -G dialout $USER
# Log out and back in for changes to take effect
```

### Numbers display incorrectly

- Double-check all wiring connections
- Verify you have a **common cathode** 5461AS (not common anode)
- Test individual segments by modifying the test script

### Pico not detected

1. Ensure MicroPython is installed (see Step 1)
2. Try a different USB cable (some are power-only)
3. Check if the Pico appears in `lsusb` output
4. Try a different USB port on your Pi5

### Display shows wrong count

The bot sends updates via serial at 115200 baud. To debug:

```bash
# Monitor what the bot is sending
cat /dev/ttyACM0
```

You should see lines like:
```
COUNT:42
COUNT:43
```

## Manual Testing

To test the display without the bot:

```python
# On your Pico (via mpremote or Thonny)
from machine import Pin
import time

# Test a single segment
seg_a = Pin(10, Pin.OUT)
seg_a.value(1)  # Turn on segment A

# Test a single digit
digit_1 = Pin(9, Pin.OUT)
digit_1.value(1)  # Enable digit 1
```

## Advanced: Auto-start on Pi5 Boot

To ensure the Pico script runs even after power cycles, the deployment script already copies it as `main.py` on the Pico, which runs automatically on boot.

For the bot to auto-start on Pi5 boot, see the existing systemd service setup in other documentation.

## Files Created

- `pico_7segment_display.py` - MicroPython code running on Pico
- `deploy-pico-7segment.sh` - Deployment script for Pi5
- `PICO_7SEGMENT_SETUP.md` - This guide

## Architecture

```
┌─────────────────┐
│   Discord Bot   │
│   (Node.js)     │
└────────┬────────┘
         │ Serial @ 115200 baud
         │ FORMAT: COUNT:####\n
         │
┌────────▼────────┐
│  Raspberry Pi   │
│   Pico (USB)    │
│  (MicroPython)  │
└────────┬────────┘
         │ GPIO Pins
         │ Multiplexing @ 125Hz
         │
┌────────▼────────┐
│  5461AS 4-Digit │
│   7-Seg Display │
└─────────────────┘
```

## Next Steps

- Add brightness control based on ambient light
- Add animations for milestone server counts
- Display other metrics (online users, CPU usage, etc.)
- Add color-changing LEDs for status indication

Enjoy your real-time server counter! 🎉
