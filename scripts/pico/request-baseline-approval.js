#!/usr/bin/env node
'use strict';

const { getHardwareSecurityHub } = require('../../darklock/services/HardwareSecurityHubService');

async function main() {
    const hub = getHardwareSecurityHub();
    await hub.start();

    const challenge = await hub.createChallenge({
        purpose: 'baseline-generation',
        adminUserId: null,
        metadata: {
            source: 'script:request-baseline-approval'
        }
    });

    console.log('RFID baseline challenge created.');
    console.log(`Challenge ID: ${challenge.id}`);
    console.log(`Expires At: ${challenge.expiresAt}`);
    console.log('Scan a registered card allowed for baseline-generation.');

    process.exit(0);
}

main().catch((err) => {
    console.error('Failed to request baseline approval:', err.message || err);
    process.exit(1);
});
