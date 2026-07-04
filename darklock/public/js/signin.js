(function() {
    'use strict';

    const rfidBtn = document.getElementById('rfidBtn');
    const statusEl = document.getElementById('status');
    const gwDot = document.getElementById('gwDot');
    const gwStatus = document.getElementById('gwStatus');
    const authMethod = document.getElementById('authMethod');
    const rfidSection = document.getElementById('rfidSection');
    const passwordSection = document.getElementById('passwordSection');
    const showPasswordBtn = document.getElementById('showPasswordBtn');
    const showRfidBtn = document.getElementById('showRfidBtn');
    const passwordForm = document.getElementById('passwordForm');
    const passwordBtn = document.getElementById('passwordBtn');

    let pendingChallenge = null;
    let pendingPollTimer = null;
    let gatewayInterval = null;

    function getCookie(name) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]+)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function getCsrfToken() {
        return getCookie('_csrf_token') || getCookie('csrf_token') || '';
    }

    function authHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const csrf = getCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf;
        }
        return headers;
    }

    function showStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'status visible ' + type;
    }

    function hideStatus() {
        statusEl.className = 'status';
        statusEl.textContent = '';
    }

    function clearChallengePolling() {
        if (pendingPollTimer) {
            clearInterval(pendingPollTimer);
            pendingPollTimer = null;
        }
    }

    function startChallengePolling() {
        clearChallengePolling();
        pollChallenge();
        pendingPollTimer = setInterval(pollChallenge, 2500);
    }

    showPasswordBtn.addEventListener('click', () => {
        rfidSection.style.display = 'none';
        passwordSection.style.display = 'block';
        authMethod.textContent = 'Password authentication';
        hideStatus();
        clearChallengePolling();
    });

    showRfidBtn.addEventListener('click', () => {
        passwordSection.style.display = 'none';
        rfidSection.style.display = 'block';
        authMethod.textContent = 'Choose authentication method';
        hideStatus();
        clearChallengePolling();
    });

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideStatus();
        passwordBtn.disabled = true;
        passwordBtn.classList.add('loading');

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/signin', {
                method: 'POST',
                headers: authHeaders(),
                credentials: 'same-origin',
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success && data.redirect) {
                showStatus('Authentication successful! Redirecting...', 'success');
                setTimeout(() => { window.location.href = data.redirect; }, 500);
            } else if (data.success && data.rfidRequired && data.challengeId && data.challengeToken) {
                pendingChallenge = {
                    challengeId: data.challengeId,
                    challengeToken: data.challengeToken,
                    challengeExpiresAt: data.challengeExpiresAt,
                };

                showStatus('Password verified. Scan your RFID card now...', 'info');
                authMethod.textContent = 'Password verified - waiting for RFID scan';

                passwordSection.style.display = 'none';
                rfidSection.style.display = 'block';

                startChallengePolling();
            } else {
                showStatus(data.error || 'Authentication failed', 'error');
            }
        } catch (_err) {
            showStatus('Connection error. Please try again.', 'error');
        } finally {
            passwordBtn.disabled = false;
            passwordBtn.classList.remove('loading');
        }
    });

    async function checkGateway() {
        try {
            const res = await fetch('/api/rfid/status', { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                if (data.online) {
                    gwDot.className = 'dot online';
                    gwStatus.textContent = 'Gateway online · ' + data.cards + ' card(s) registered';
                    rfidBtn.disabled = false;
                    authMethod.textContent = 'RFID card or password';
                    return;
                }
            }

            if (gatewayInterval) {
                clearInterval(gatewayInterval);
                gatewayInterval = null;
            }
            gwDot.className = 'dot offline';
            gwStatus.textContent = 'Gateway offline - Use password authentication';
            rfidBtn.disabled = true;
            authMethod.textContent = 'Password authentication required';
        } catch (_err) {
            if (gatewayInterval) {
                clearInterval(gatewayInterval);
                gatewayInterval = null;
            }
            gwDot.className = 'dot offline';
            gwStatus.textContent = 'Gateway unreachable - Use password authentication';
            rfidBtn.disabled = true;
            authMethod.textContent = 'Password authentication required';
        }
    }

    async function handleRfidLogin() {
        hideStatus();
        rfidBtn.disabled = true;
        rfidBtn.classList.add('loading');

        try {
            if (!pendingChallenge) {
                showStatus('Enter password first to create an RFID challenge.', 'error');
                return;
            }

            showStatus('Waiting for RFID challenge approval...', 'info');

            const response = await fetch('/signin/rfid', {
                method: 'POST',
                headers: authHeaders(),
                credentials: 'same-origin',
                body: JSON.stringify({
                    challengeId: pendingChallenge.challengeId,
                    challengeToken: pendingChallenge.challengeToken
                })
            });

            if (response.status === 202) {
                showStatus('Waiting for RFID challenge approval...', 'info');
                return;
            }

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const errorMsg = data.error || 'RFID authentication failed';
                showStatus(errorMsg, 'error');
                return;
            }

            const data = await response.json();
            if (data.success && data.redirect) {
                clearChallengePolling();
                pendingChallenge = null;
                showStatus('Access granted! Redirecting...', 'success');
                setTimeout(() => { window.location.href = data.redirect; }, 800);
            } else {
                showStatus(data.error || 'RFID authentication failed', 'error');
            }
        } catch (_err) {
            showStatus('Connection error. Please use password authentication.', 'error');
        } finally {
            rfidBtn.disabled = false;
            rfidBtn.classList.remove('loading');
        }
    }

    async function fetchChallengeStatus() {
        if (!pendingChallenge) return null;

        const response = await fetch('/signin/rfid/status', {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({
                challengeId: pendingChallenge.challengeId,
                challengeToken: pendingChallenge.challengeToken
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            return {
                ok: false,
                status: response.status,
                error: data.error || 'Failed to fetch challenge status'
            };
        }

        const data = await response.json();
        return {
            ok: true,
            status: data.status,
            expiresAt: data.expiresAt
        };
    }

    async function pollChallenge() {
        if (!pendingChallenge) return;

        const expiresAt = new Date(pendingChallenge.challengeExpiresAt || 0).getTime();
        if (expiresAt && Date.now() > expiresAt) {
            clearChallengePolling();
            pendingChallenge = null;
            showStatus('RFID challenge expired. Re-enter password and try again.', 'error');
            return;
        }

        try {
            const state = await fetchChallengeStatus();
            if (!state) return;

            if (!state.ok) {
                if (state.status === 410) {
                    clearChallengePolling();
                    pendingChallenge = null;
                    showStatus('RFID challenge expired. Re-enter password and try again.', 'error');
                    return;
                }

                if (state.status === 404) {
                    clearChallengePolling();
                    pendingChallenge = null;
                    showStatus('RFID challenge not found. Re-enter password and try again.', 'error');
                    return;
                }

                showStatus(state.error, 'error');
                return;
            }

            if (state.status === 'pending') {
                showStatus('Waiting for RFID challenge approval...', 'info');
                return;
            }

            if (state.status === 'approved') {
                await handleRfidLogin();
                return;
            }

            if (state.status === 'expired') {
                clearChallengePolling();
                pendingChallenge = null;
                showStatus('RFID challenge expired. Re-enter password and try again.', 'error');
                return;
            }

            if (state.status === 'consumed') {
                clearChallengePolling();
                pendingChallenge = null;
                showStatus('RFID challenge already used. Re-enter password to continue.', 'error');
            }
        } catch (_err) {
            showStatus('Failed to poll RFID status. Please try again.', 'error');
        }
    }

    rfidBtn.addEventListener('click', handleRfidLogin);
    checkGateway();
    gatewayInterval = setInterval(checkGateway, 30000);
})();
