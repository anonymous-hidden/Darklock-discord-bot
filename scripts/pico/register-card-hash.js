#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const RfidApprovalService = require('../../darklock/services/RfidApprovalService');

function usage() {
    console.log('Usage: node scripts/pico/register-card-hash.js --label "My Card" --uid "DEADBEEF" --purposes admin-login,baseline-generation');
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
        out[key] = value;
        if (value !== 'true') i += 1;
    }
    return out;
}

function hashUid(uid, secret) {
    return crypto.createHmac('sha256', secret).update(String(uid).trim(), 'utf8').digest('hex');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const label = args.label;
    const uid = args.uid;
    const secret = process.env.RFID_HASH_SECRET || '';

    if (!label || !uid) {
        usage();
        process.exit(1);
    }

    if (!secret) {
        console.error('RFID_HASH_SECRET is required. Refusing to hash UID.');
        process.exit(1);
    }

    const purposes = String(args.purposes || 'admin-login')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

    const uidHash = hashUid(uid, secret);

    const service = new RfidApprovalService({ logger: console });
    await service.initSchema();

    const card = await service.registerCardHash({
        label,
        uidHash,
        allowedPurposes: purposes,
        enabled: String(args.enabled || 'true') !== 'false',
    });

    console.log('Card registered:');
    console.log(JSON.stringify({
        id: card.id,
        label: card.label,
        enabled: card.enabled,
        allowedPurposes: card.allowedPurposes,
        uidHashPrefix: card.uidHash.slice(0, 16),
    }, null, 2));
}

main().catch((err) => {
    console.error('Failed to register card hash:', err.message || err);
    process.exit(1);
});
