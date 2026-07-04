'use strict';

const express = require('express');
const { getHardwareSecurityHub } = require('../../services/HardwareSecurityHubService');

const router = express.Router();

function parsePurposes(input) {
    if (Array.isArray(input)) {
        return input.map((v) => String(v).trim()).filter(Boolean);
    }

    if (typeof input === 'string' && input.trim()) {
        return input.split(',').map((v) => v.trim()).filter(Boolean);
    }

    return [];
}

router.get('/status', async (req, res) => {
    try {
        const hub = getHardwareSecurityHub();
        const status = await hub.getStatus();

        return res.json({
            success: true,
            enabled: hub.isEnabled(),
            ...status,
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/cards', async (req, res) => {
    try {
        const hub = getHardwareSecurityHub();
        const cards = await hub.listCards();
        return res.json({ success: true, cards });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/cards/register-hash', async (req, res) => {
    try {
        const { label, uidHash, allowedPurposes, enabled } = req.body || {};

        if (!label || !uidHash) {
            return res.status(400).json({ success: false, error: 'label and uidHash are required' });
        }

        const hub = getHardwareSecurityHub();
        const card = await hub.registerCardHash({
            label: String(label),
            uidHash: String(uidHash),
            allowedPurposes: parsePurposes(allowedPurposes),
            enabled: enabled !== false,
        });

        return res.json({ success: true, card });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/cards/enroll', async (req, res) => {
    try {
        const { label, uid, allowedPurposes, enabled } = req.body || {};

        if (!label || !uid) {
            return res.status(400).json({ success: false, error: 'label and uid are required' });
        }

        const hub = getHardwareSecurityHub();
        let uidHash;
        try {
            uidHash = await hub.hashUid(String(uid));
        } catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }

        const card = await hub.registerCardHash({
            label: String(label),
            uidHash,
            allowedPurposes: parsePurposes(allowedPurposes),
            enabled: enabled !== false,
        });

        return res.json({
            success: true,
            warning: 'Raw UID enrollment should only be used in local trusted admin context.',
            card
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/challenge', async (req, res) => {
    try {
        const { purpose, ttlSeconds } = req.body || {};
        if (!purpose) {
            return res.status(400).json({ success: false, error: 'purpose is required' });
        }

        const hub = getHardwareSecurityHub();
        const challenge = await hub.createChallenge({
            purpose: String(purpose),
            adminUserId: req.admin?.id || null,
            ttlSeconds: Number(ttlSeconds) || undefined,
            metadata: {
                requestedByEmail: req.admin?.email || null,
                source: 'admin-api',
            },
        });

        return res.json({ success: true, challenge });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/challenge/:id', async (req, res) => {
    try {
        const hub = getHardwareSecurityHub();
        const challenge = await hub.getChallengeStatus({ challengeId: req.params.id });
        if (!challenge) {
            return res.status(404).json({ success: false, error: 'challenge not found' });
        }
        return res.json({ success: true, challenge });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/events', async (req, res) => {
    try {
        const hub = getHardwareSecurityHub();
        const limit = Number(req.query.limit) || 50;
        const events = await hub.listRecentEvents(limit);
        return res.json({ success: true, events });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/led', async (req, res) => {
    try {
        const { state } = req.body || {};
        if (!state) {
            return res.status(400).json({ success: false, error: 'state is required' });
        }

        const hub = getHardwareSecurityHub();
        const ok = await hub.sendLedState(state);
        return res.json({ success: ok });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
