'use strict';

const RfidApprovalService = require('../darklock/services/RfidApprovalService');

let instance = null;

function getService(logger = console) {
    if (!instance) {
        instance = new RfidApprovalService({ logger });
    }
    return instance;
}

async function ensureBaselineApproval({ logger = console } = {}) {
    const required = process.env.BASELINE_RFID_REQUIRED !== 'false';
    if (!required) {
        return {
            required: false,
            consumed: false,
            reason: 'baseline_rfid_not_required',
        };
    }

    const service = getService(logger);
    await service.initSchema();

    const approval = await service.consumeBaselineApproval();
    if (!approval) {
        const err = new Error('RFID baseline approval required and not found (or expired)');
        err.code = 'BASELINE_RFID_APPROVAL_REQUIRED';
        throw err;
    }

    return {
        required: true,
        consumed: true,
        approval,
    };
}

module.exports = {
    getService,
    ensureBaselineApproval,
};
