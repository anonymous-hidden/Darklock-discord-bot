#!/usr/bin/env node
'use strict';

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

async function pickPort() {
    const envPath = process.env.PICO_SERIAL_PATH;
    if (envPath && envPath !== 'auto') return envPath;

    const ports = await SerialPort.list();
    const preferred = ports.find((p) => (
        (p.vendorId && p.vendorId.toLowerCase() === '2e8a') ||
        /ttyACM/i.test(String(p.path || ''))
    ));

    if (preferred) return preferred.path;

    const fallback = ports.find((p) => /ttyUSB|usbmodem|ttyACM/i.test(String(p.path || '')));
    return fallback ? fallback.path : null;
}

function parseJsonLine(line) {
    try {
        return JSON.parse(line);
    } catch (_) {
        return null;
    }
}

async function main() {
    const baudRate = Number(process.env.PICO_BAUD_RATE || 115200);
    const portPath = await pickPort();

    if (!portPath) {
        console.error('[pico:test] No Pico serial device found.');
        process.exit(1);
    }

    console.log(`[pico:test] Opening ${portPath} @ ${baudRate}`);

    const port = new SerialPort({ path: portPath, baudRate });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    let sawHeartbeat = false;
    const deadline = Date.now() + 15000;

    parser.on('data', (line) => {
        const text = String(line || '').trim();
        if (!text) return;

        const parsed = parseJsonLine(text);
        if (!parsed) {
            console.log('[pico:test] non-json:', text);
            return;
        }

        console.log('[pico:test] json:', parsed);

        if (parsed.type === 'heartbeat') {
            sawHeartbeat = true;
            port.write(JSON.stringify({ type: 'led', state: 'ready' }) + '\n');
        }
    });

    const timer = setInterval(() => {
        if (sawHeartbeat) {
            clearInterval(timer);
            console.log('[pico:test] Heartbeat received. Serial bridge path is healthy.');
            try { port.close(); } catch (_) {}
            process.exit(0);
        }

        if (Date.now() > deadline) {
            clearInterval(timer);
            console.error('[pico:test] Timed out waiting for heartbeat.');
            try { port.close(); } catch (_) {}
            process.exit(1);
        }
    }, 500);
}

main().catch((err) => {
    console.error('[pico:test] Fatal error:', err.message || err);
    process.exit(1);
});
