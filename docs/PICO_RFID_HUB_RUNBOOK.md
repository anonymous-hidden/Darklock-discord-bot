# Pico 2 W USB RFID Hub Runbook

This runbook covers firmware setup, card enrollment, admin-login RFID flow, baseline approval flow, and safe deployment for DarkLock.

## 1) Prerequisites

- Raspberry Pi Pico 2 W connected by USB.
- RC522 wired as documented in `hardware/pico2w/rfid-hub/README.md`.
- User account in `dialout` group on Linux host.
- MicroPython tooling available:
  - `mpremote` installed and in PATH.
- Environment variables configured:
  - `HARDWARE_HUB_ENABLED=true`
  - `PICO_RFID_ENABLED=true`
  - `PICO_SERIAL_PATH=/dev/ttyACM0` (or your path)
  - `PICO_BAUD_RATE=115200`
  - `PICO_DEVICE_ID=pico2w-rfid-01`
  - `RFID_HASH_SECRET=<64+ char secret>`
  - `BASELINE_RFID_REQUIRED=true`

## 2) Install Pico Firmware

From repo root:

```bash
npm run pico:install
```

Expected:
- `main.py` and `mfrc522.py` copied to Pico.
- If needed, soft reset:

```bash
mpremote connect /dev/ttyACM0 reset
```

## 3) Verify USB Serial Heartbeat

```bash
npm run pico:test
```

Expected success:
- JSON heartbeat lines appear.
- Script exits with `Heartbeat received. Serial bridge path is healthy.`

## 4) Register RFID Cards (Server-Side Hash)

Use raw UID locally only on trusted admin host.

```bash
RFID_HASH_SECRET='<secret>' npm run rfid:register -- --label "Owner Card" --uid "DEADBEEF" --purposes "admin-login,baseline-generation"
```

Expected:
- `Card registered` JSON printed.
- UID hash is stored (not raw UID).

## 5) Admin Login RFID Challenge Flow

Behavior:
1. Admin enters email/password on signin page.
2. Server returns `rfidRequired` + `challengeId` + `challengeToken`.
3. Frontend polls `POST /signin/rfid/status` with JSON body (`challengeId`, `challengeToken`) and CSRF header.
4. When status becomes `approved`, frontend calls `POST /signin/rfid` to consume challenge and create session cookie.

Notes:
- Polling does not consume rate-limited signin attempts.
- `POST /signin/rfid` only succeeds once challenge is approved.

## 6) Baseline RFID Approval Flow

Request one-time approval challenge:

```bash
npm run tamper:rfid:request
```

Then scan a card allowed for `baseline-generation`, and generate baseline:

```bash
npm run tamper:generate
```

Expected:
- Without approval: baseline generation fails closed.
- With approval: baseline generation succeeds and approval is consumed once.

## 7) Hardware Admin API

Mounted at:
- `/api/admin/hardware`

Examples:
- `GET /api/admin/hardware/status`
- `GET /api/admin/hardware/cards`
- `POST /api/admin/hardware/challenge`
- `GET /api/admin/hardware/challenge/:id`
- `GET /api/admin/hardware/events`

Requires admin auth (`requireAdminAuth`).

## 8) Safe Deploy (Pi)

Preview deployment helper:

```bash
SERVER_USER=darklock SERVER_HOST=<pi-host-or-ip> bash scripts/deploy-rfid-hub.sh
```

Then run the printed `rsync` and remote commands manually after review.

## 9) Troubleshooting

### `Cannot lock port /dev/ttyACM0`
- Another process is holding the serial device (often Thonny backend).
- Identify owner:

```bash
lsof /dev/ttyACM0
```

- Stop the process, then retry `npm run pico:test`.

### `Timed out waiting for heartbeat`
- Firmware not running or board not reset after copy.
- Run:

```bash
npm run pico:install
mpremote connect /dev/ttyACM0 reset
npm run pico:test
```

### `RFID_HASH_SECRET is required`
- Set `RFID_HASH_SECRET` to a strong 64+ character secret in environment.

### Env validation failures during local smoke tests
- `ADMIN_JWT_SECRET` / `JWT_SECRET` must satisfy minimum length checks in this repo.

## 10) Validation Checklist

- `npm run pico:install` passes.
- `npm run pico:test` receives heartbeat.
- Card registration script succeeds.
- Baseline request script creates challenge.
- Baseline generation is blocked without approval.
- Baseline generation succeeds once after approval.
- Admin login challenge transitions `pending -> approved -> consumed`.
- USB disconnect/reconnect recovers bridge status.
