# DARKLOCK PHYSICAL SECURITY GATE
## Production Security System Documentation

---

## 📋 SYSTEM OVERVIEW

**Purpose**: Physical RFID key requirement for Discord bot operation and admin panel access

**Security Model**: **FAIL CLOSED**
- No hardware key = No bot operation
- No hardware key = No admin access
- Hardware failure = System locks down

**Components**:
1. **Arduino Mega 2560** - RFID reader + LCD display
2. **Raspberry Pi 5** - Bot runtime + web dashboard
3. **RC522 RFID Reader** - Physical key detection
4. **16x2 LCD Display** - Visual status feedback

---

## 🔐 SECURITY ARCHITECTURE

### Three-Layer Security Model

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Physical Hardware                         │
│  • RFID RC522 reader must detect authorized card    │
│  • Card must remain present (not just scanned once) │
│  • Removal = immediate lockout                      │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  Layer 2: Arduino Firmware                          │
│  • Continuously scans for card presence             │
│  • Validates UID against authorized list            │
│  • Sends state over serial to Pi                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  Layer 3: Backend Application                       │
│  • Monitors serial connection                       │
│  • Maintains hardwareKeyPresent state               │
│  • Enforces shutdown on RFID_LOST                   │
└─────────────────────────────────────────────────────┘
```

### Critical Security Properties

✅ **Fail Closed**: Hardware failure = deny access  
✅ **Continuous Presence**: Card must remain present, not just scanned  
✅ **No Bypass**: Cannot be overridden remotely or via API  
✅ **Immediate Lockout**: Card removal triggers instant bot shutdown  
✅ **Tamper Detection**: Invalid cards logged with UID  

---

## 📊 DATA FLOW

### Normal Operation Flow

```
1. Arduino scans RFID every 250ms
2. Authorized card detected → RFID_OK
3. Pi receives RFID_OK → hardwareKeyPresent = true
4. Bot allowed to run
5. Admin panel accessible (+ password)

┌──────────┐         ┌──────────┐         ┌──────────┐
│  RFID    │  scan   │ Arduino  │ serial  │    Pi    │
│  Card    ├────────>│  Mega    ├────────>│ Backend  │
│          │         │          │ RFID_OK │          │
└──────────┘         └──────────┘         └──────────┘
                          │                     │
                          v                     v
                    ┌──────────┐         ┌──────────┐
                    │   LCD    │         │   Bot    │
                    │ Display  │         │ Running  │
                    └──────────┘         └──────────┘
```

### Lockout Flow (Card Removed)

```
1. Card not detected for 3 seconds
2. Arduino sends RFID_LOST
3. Pi receives → hardwareKeyPresent = false
4. Pi triggers bot.shutdown()
5. Admin panel returns HTTP 403

┌──────────┐         ┌──────────┐         ┌──────────┐
│   User   │ removes │  RFID    │  scan   │ Arduino  │
│  Action  ├────────>│  Reader  ├────────>│  Mega    │
│          │         │ (empty)  │         │          │
└──────────┘         └──────────┘         └──────────┘
                                                │
                                                v
                          ┌─────────────────────────┐
                          │ Card absent > 3 sec     │
                          │ → RFID_LOST             │
                          └─────────────────────────┘
                                                │
                                                v
                          ┌──────────┐         ┌──────────┐
                          │    Pi    │ trigger │   Bot    │
                          │ Backend  ├────────>│ Shutdown │
                          │          │         │          │
                          └──────────┘         └──────────┘
                                │
                                v
                          ┌──────────┐
                          │  Admin   │
                          │  Panel   │
                          │ (403)    │
                          └──────────┘
```

---

## 🔌 HARDWARE CONNECTIONS

### Arduino Mega 2560 Pin Mapping

**RC522 RFID (SPI - 3.3V!):**
```
RC522 Pin    Arduino Pin    Notes
─────────────────────────────────────
SDA (SS)  →  D53           Chip select
SCK       →  D52           SPI clock
MOSI      →  D51           Master out
MISO      →  D50           Master in
RST       →  D49           Reset
3.3V      →  3.3V          ⚠️ NOT 5V!
GND       →  GND           Common ground
IRQ       →  (unused)      Not needed
```

**LCD 16x2 HD44780 (4-bit parallel - 5V):**
```
LCD Pin      Arduino Pin    Function
─────────────────────────────────────
RS        →  A0             Register select
E         →  A1             Enable (critical!)
D4        →  A2             Data bit 4
D5        →  A3             Data bit 5
D6        →  A4             Data bit 6
D7        →  A5             Data bit 7
RW        →  GND            Write mode
VSS       →  GND            Ground
VDD       →  5V             Power
VO        →  Pot center     Contrast (10K pot)
A         →  5V (220Ω)      Backlight anode
K         →  GND            Backlight cathode
```

**Power Distribution:**
- Arduino powered via USB (5V from Pi)
- RC522 uses **3.3V** (NOT 5V - will damage reader!)
- LCD uses 5V
- All grounds connected to common rail

---

## 📡 SERIAL PROTOCOL

**Baud Rate**: 115200  
**Format**: Newline-terminated ASCII strings

### Messages: Arduino → Pi

| Message | Meaning | When Sent |
|---------|---------|-----------|
| `BOOT_OK` | Arduino initialized successfully | On startup |
| `RFID_OK` | Authorized card present | Card detected & validated |
| `RFID_LOST` | Card removed or timeout | No card for 3 seconds |
| `RFID_INVALID` | Unknown card scanned | Unauthorized UID detected |
| `INVALID_UID:XXXX` | UID of invalid card | After RFID_INVALID |
| `HEARTBEAT` | Arduino alive | Every 5 seconds |
| `ERROR:xxx` | Hardware error | RFID init failed, etc. |

### Messages: Pi → Arduino

| Command | Response | Purpose |
|---------|----------|---------|
| `STATUS` | Current state | Query current RFID state |
| `PING` | `PONG` | Connection test |
| `VERSION` | `DARKLOCK_V1.0` | Firmware version |

---

## 🛡️ FAILURE MODES & SAFETY

### Scenario 1: Hardware Disconnected

**Trigger**: USB cable unplugged, Arduino loses power  
**Detection**: Serial connection closed OR heartbeat timeout  
**Response**:
1. `hardwareKeyPresent` set to `false`
2. Bot shutdown triggered immediately
3. Admin panel returns HTTP 503

**Safety**: ✅ Fail closed - system locks

---

### Scenario 2: RFID Card Removed

**Trigger**: Card taken away from reader  
**Detection**: No card detected for 3 consecutive seconds  
**Response**:
1. Arduino sends `RFID_LOST`
2. LCD shows "KEY REMOVED"
3. Pi shuts down bot within 5 seconds
4. Admin panel returns HTTP 403

**Safety**: ✅ Immediate lockout

---

### Scenario 3: Invalid Card Scanned

**Trigger**: Unknown UID presented to reader  
**Detection**: UID not in authorized list  
**Response**:
1. Arduino sends `RFID_INVALID` + `INVALID_UID:xxx`
2. LCD shows "INVALID KEY"
3. Event logged (potential intrusion attempt)
4. Bot continues running IF valid card still present

**Safety**: ✅ Intrusion attempt logged, no access granted

---

### Scenario 4: RFID Hardware Failure

**Trigger**: RC522 reader not responding (VersionReg = 0x00 or 0xFF)  
**Detection**: At Arduino boot  
**Response**:
1. Arduino sends `ERROR:RFID_INIT_FAILED`
2. LCD shows "ERROR: RFID"
3. Arduino halts (infinite loop)
4. Pi cannot start (no BOOT_OK received)

**Safety**: ✅ System cannot operate without functioning RFID

---

### Scenario 5: Heartbeat Timeout

**Trigger**: No heartbeat received for 15 seconds  
**Detection**: Pi-side timer  
**Response**:
1. `hardwareKeyPresent` set to `false`
2. Bot shutdown triggered
3. Serial reconnection attempted

**Safety**: ✅ Unresponsive hardware = lockout

---

### Scenario 6: Power Loss (Pi or Arduino)

**Trigger**: Power outage, brownout, crash  
**Detection**: Process termination  
**Response**:
- Bot terminates (no power)
- On reboot: Bot will NOT start until RFID key present
- `requireHardwareForBoot: true` enforces this

**Safety**: ✅ Reboot requires physical key presence

---

## 🔧 CONFIGURATION

### Arduino Configuration

Edit `darklock_security_gate.ino`:

```cpp
// Add authorized card UIDs here
const byte AUTHORIZED_CARDS[][5] = {
  {4, 0xDE, 0xAD, 0xBE, 0xEF},  // 4-byte UID
  {7, 0x04, 0x52, 0xC6, 0xAA, 0x2E, 0x5C, 0x80}  // 7-byte UID
};
```

**How to get your card's UID:**
1. Upload sketch
2. Open serial monitor (115200 baud)
3. Scan unknown card
4. Look for `INVALID_UID:XXXXXXXX` message
5. Add UID to AUTHORIZED_CARDS array

### Backend Configuration

Environment variables:

```bash
# Serial port (auto-detected on Linux)
HARDWARE_SERIAL_PORT=/dev/ttyACM0

# Security policy
FAIL_CLOSED=true                      # Lock on hardware failure
REQUIRE_HARDWARE_FOR_BOOT=true        # Cannot start without key

# Timing
HARDWARE_TIMEOUT=15000                # Heartbeat timeout (ms)
SHUTDOWN_GRACE_PERIOD=5000            # Bot shutdown grace (ms)

# Admin password
ADMIN_PASSWORD=your_secure_password
```

---

## 📦 INSTALLATION

### 1. Arduino Setup

```bash
# Navigate to hardware directory
cd hardware/darklock_security_gate

# Compile firmware
arduino-cli compile --fqbn arduino:avr:mega darklock_security_gate

# Upload to Arduino Mega
arduino-cli upload -p /dev/ttyACM0 --fqbn arduino:avr:mega darklock_security_gate
```

### 2. Node.js Dependencies

```bash
# Install required packages
npm install serialport @serialport/parser-readline express
```

### 3. Test Hardware

```bash
# Monitor serial output
arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200

# Expected output:
# BOOT_OK
# RFID_VERSION:92
# HEARTBEAT
# (scan card) → RFID_OK or RFID_INVALID
```

### 4. Start Backend

```bash
node examples/darklock-integration-example.js
```

---

## 🧪 TESTING CHECKLIST

### Hardware Tests

- [ ] LCD shows "Darklock v1.0" on boot
- [ ] LCD shows "Booting..." during init
- [ ] RFID reader responds (version != 0x00/0xFF)
- [ ] Heartbeat messages sent every 5 seconds

### RFID Tests

- [ ] Authorized card → `RFID_OK` + LCD "KEY VERIFIED"
- [ ] Invalid card → `RFID_INVALID` + LCD "INVALID KEY"
- [ ] Card removal → `RFID_LOST` within 3 seconds
- [ ] Card re-scan → `RFID_OK` again

### Backend Tests

- [ ] Serial connection established
- [ ] `hardwareKeyPresent` updates correctly
- [ ] Bot shuts down on `RFID_LOST`
- [ ] Admin panel returns 403 without key
- [ ] Admin panel accessible with key + password

### Failure Mode Tests

- [ ] Unplug USB → bot shuts down
- [ ] Heartbeat timeout → bot shuts down
- [ ] Arduino reset → reconnects automatically
- [ ] Invalid card scan → logged but no access

---

## 🚨 SECURITY CONSIDERATIONS

### What This System Protects Against

✅ Remote unauthorized bot control  
✅ Remote unauthorized admin access  
✅ Software-only attacks (requires physical presence)  
✅ Bot running without operator present  

### What This System Does NOT Protect Against

❌ Physical access to Raspberry Pi (can edit code)  
❌ Supply chain attacks (compromised hardware)  
❌ RFID cloning (if attacker captures card data)  
❌ Social engineering (authorized user coerced)  

### Recommendations

1. **Store Pi in locked enclosure**
2. **Use RFID cards with encryption** (MIFARE DESFire)
3. **Monitor invalid card attempts** (potential intrusion)
4. **Keep authorized UID list in encrypted storage**
5. **Implement audit logging** for all admin actions
6. **Use strong admin passwords** (layer 2 security)
7. **Consider adding tamper switches** (enclosure opening detection)

---

## 🔍 MONITORING & LOGGING

### Log Levels

- **INFO**: Normal operation (key granted, bot started)
- **WARN**: Security events (key revoked, invalid card)
- **ERROR**: Hardware failures (RFID init, heartbeat timeout)
- **DEBUG**: Verbose serial communication (production: off)

### Key Events to Monitor

| Event | Severity | Action |
|-------|----------|--------|
| `RFID_INVALID` | WARN | Log UID, alert admin |
| `RFID_LOST` | WARN | Normal operation |
| `HARDWARE_DISCONNECTED` | ERROR | Alert admin immediately |
| `HEARTBEAT_TIMEOUT` | ERROR | Check hardware connection |
| `shutdown-required` | CRITICAL | Bot shutting down |

### Statistics Available

```javascript
securityGate.getStats()
// Returns:
{
  uptime: 123456,
  messagesReceived: 450,
  rfidOkCount: 15,
  rfidLostCount: 14,
  rfidInvalidCount: 2,        // ⚠️ Potential intrusions
  reconnectCount: 1,
  lastStateChange: 1234567890,
  hardwareConnected: true,
  keyPresent: true,
  lastHeartbeat: 1234567890
}
```

---

## 🛠️ TROUBLESHOOTING

### Problem: LCD shows white squares

**Cause**: Loose Enable pin (A1) connection  
**Fix**: Check pin A1 wiring, ensure firm connection

### Problem: `ERROR:RFID_INIT_FAILED`

**Cause**: RC522 not responding (wiring or voltage issue)  
**Fix**:
1. Check 3.3V power (NOT 5V!)
2. Verify SPI connections (pins 49-53)
3. Check common ground

### Problem: `RFID_INVALID` for authorized card

**Cause**: UID not in AUTHORIZED_CARDS array  
**Fix**:
1. Read UID from `INVALID_UID:` message
2. Add to AUTHORIZED_CARDS in firmware
3. Re-upload sketch

### Problem: Bot starts without hardware key

**Cause**: `requireHardwareForBoot: false`  
**Fix**: Set to `true` in config (fail closed)

### Problem: Serial connection fails

**Cause**: Permission denied on `/dev/ttyACM0`  
**Fix**:
```bash
sudo chmod 666 /dev/ttyACM0
# Or add user to dialout group:
sudo usermod -a -G dialout $USER
```

---

## 📚 API REFERENCE

### HardwareSecurityGate Class

```javascript
const gate = new HardwareSecurityGate(config);

// Start monitoring
await gate.start();

// Check status
gate.isKeyPresent()        // boolean
gate.isHardwareConnected() // boolean
gate.getStats()            // object

// Send commands
gate.sendCommand('STATUS')
gate.sendCommand('PING')

// Shutdown
await gate.shutdown()
```

### Events

```javascript
gate.on('key-granted', (reason) => { })
gate.on('key-revoked', (reason) => { })
gate.on('shutdown-required', ({ reason, gracePeriod }) => { })
gate.on('invalid-card', () => { })
gate.on('invalid-uid', (uid) => { })
gate.on('connected', () => { })
gate.on('disconnected', () => { })
```

### Express Middleware

```javascript
// Require hardware key for route
app.use('/admin', requireHardwareKey(gate))

// Add hardware context to request
app.use(hardwareSecurityContext(gate))
// → req.hardwareSecurity.keyPresent
```

---

## 📄 LICENSE & CREDITS

**System**: Darklock Physical Security Gate  
**Hardware**: ELEGOO Mega 2560 + RC522 RFID + HD44780 LCD  
**Author**: Built for Discord bot security enforcement  
**Security Model**: Fail-closed, continuous presence verification

---

## ✅ DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] Authorized UIDs added to firmware
- [ ] Firmware compiled and uploaded
- [ ] Hardware connections verified
- [ ] Serial communication tested
- [ ] Admin password set (strong!)
- [ ] Environment variables configured

### Post-Deployment

- [ ] Monitor logs for 24 hours
- [ ] Test card removal → bot shutdown
- [ ] Test admin panel access with/without key
- [ ] Verify heartbeat messages received
- [ ] Test hardware reconnection after reboot

### Production Hardening

- [ ] Pi in locked enclosure
- [ ] UPS backup power
- [ ] Audit logging enabled
- [ ] Invalid card alerts configured
- [ ] Tamper detection (optional)
- [ ] Backup admin access documented

---

**REMEMBER: This is a HARD security gate. If the key is lost/damaged, you will need physical access to the Pi to edit code or add new authorized UIDs.**

Keep a backup card in a secure location!
