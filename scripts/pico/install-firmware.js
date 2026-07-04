#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SerialPort } = require('serialport');

const ROOT = path.resolve(__dirname, '..', '..');
const FW_DIR = path.join(ROOT, 'hardware', 'pico2w', 'rfid-hub');
const FILES = ['main.py', 'mfrc522.py'];

function hasMpremote() {
    const r = spawnSync('mpremote', ['--help'], { stdio: 'ignore' });
    return r.status === 0;
}

async function detectSerialPath() {
    const envPath = process.env.PICO_SERIAL_PATH;
    if (envPath && envPath !== 'auto') return envPath;

    const ports = await SerialPort.list();
    const preferred = ports.find((p) => (
        (p.vendorId && p.vendorId.toLowerCase() === '2e8a') ||
        /ttyACM/i.test(String(p.path || '')) ||
        /raspberry/i.test(String(p.manufacturer || ''))
    ));

    if (preferred) return preferred.path;

    const fallback = ports.find((p) => /ttyUSB|usbmodem|ttyACM/i.test(String(p.path || '')));
    return fallback ? fallback.path : null;
}

function copyFile(serialPath, localFile, remoteName) {
    const args = ['connect', serialPath, 'fs', 'cp', localFile, `:${remoteName}`];
    const r = spawnSync('mpremote', args, { stdio: 'inherit' });
    return r.status === 0;
}

async function main() {
    console.log('[pico:install] Installing Pico RFID firmware...');

    for (const name of FILES) {
        const filePath = path.join(FW_DIR, name);
        if (!fs.existsSync(filePath)) {
            console.error(`[pico:install] Missing firmware file: ${filePath}`);
            process.exit(1);
        }
    }

    if (!hasMpremote()) {
        console.error('[pico:install] mpremote is not installed.');
        console.error('Install it with:');
        console.error('  pip install mpremote');
        console.error('or');
        console.error('  python3 -m pip install mpremote');
        process.exit(1);
    }

    const serialPath = await detectSerialPath();
    if (!serialPath) {
        console.error('[pico:install] No Pico serial device found. Set PICO_SERIAL_PATH if needed.');
        process.exit(1);
    }

    console.log(`[pico:install] Using serial path: ${serialPath}`);

    for (const name of FILES) {
        const localFile = path.join(FW_DIR, name);
        console.log(`[pico:install] Copying ${name}...`);
        const ok = copyFile(serialPath, localFile, name);
        if (!ok) {
            console.error(`[pico:install] Failed to copy ${name}`);
            process.exit(1);
        }
    }

    console.log('[pico:install] Firmware copied successfully.');
    console.log('[pico:install] Power-cycle the Pico if it does not auto-restart main.py');
}

main().catch((err) => {
    console.error('[pico:install] Fatal error:', err.message || err);
    process.exit(1);
});
