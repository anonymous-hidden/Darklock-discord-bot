/**
 * Plan gating system for DarkLock Dashboard
 * Aligns runtime behavior with the payment page:
 * Free, Pro, Enterprise.
 */

const FREE_FEATURES = [
    'anti-nuke-basic',
    'anti-raid-basic',
    'anti-spam-basic',
    'anti-phishing-basic',
    'tickets-basic',
    'analytics-basic',
    'xp-basic',
    'moderation-core',
    'welcome-core',
    'dashboard-basic'
];

const PRO_FEATURES = [
    'anti-raid-advanced',
    'anti-spam-advanced',
    'anti-nuke-advanced',
    'anti-phishing',
    'automod-advanced',
    'webhook-protection',
    'tickets-advanced',
    'modmail',
    'analytics-advanced',
    'analytics-exports',
    'setup-commands',
    'admin-commands',
    'config-commands',
    'backup',
    'role-management',
    'autorole',
    'console',
    'access-generator',
    'access-share'
];

const ENTERPRISE_FEATURES = [
    'analytics-dashboard-advanced',
    'voice-monitoring',
    'channel-access-control',
    'trust-score',
    'scheduled-announcements',
    'xp-advanced',
    'beta-access',
    'priority-support',
    'multi-server'
];

const TIER_RANK = { free: 0, pro: 1, enterprise: 2 };

const PRO_ONLY_FEATURES = [...PRO_FEATURES];
const ENTERPRISE_ONLY_FEATURES = [...ENTERPRISE_FEATURES];

const PRO_NAV_ITEMS = [
    '/dashboard/console',
    '/access-generator',
    '/access-share',
    '/setup/anti-phishing',
    '/setup/autorole'
];

const ENTERPRISE_NAV_ITEMS = [
    '/setup/multi-server'
];

let userPremiumStatus = {
    isPremium: false,
    isEnterprise: false,
    tier: 'free',
    expiresAt: null,
    features: [...FREE_FEATURES]
};

function normalizeTier(tier) {
    const normalized = String(tier || '').toLowerCase().trim();
    if (normalized === 'enterprise') return 'enterprise';
    if (normalized === 'pro' || normalized === 'premium' || normalized === 'monthly' || normalized === 'starter') return 'pro';
    return 'free';
}

function buildTierFeatures(tier, serverFeatures) {
    const fromTier = tier === 'enterprise'
        ? [...FREE_FEATURES, ...PRO_FEATURES, ...ENTERPRISE_FEATURES]
        : tier === 'pro'
            ? [...FREE_FEATURES, ...PRO_FEATURES]
            : [...FREE_FEATURES];

    if (!Array.isArray(serverFeatures) || serverFeatures.length === 0) {
        return [...new Set(fromTier)];
    }

    // Keep server-declared features too, while preserving known baseline features.
    return [...new Set([...fromTier, ...serverFeatures])];
}

function hasTierAccess(requiredTier) {
    const need = TIER_RANK[normalizeTier(requiredTier)] ?? 0;
    const have = TIER_RANK[normalizeTier(userPremiumStatus.tier)] ?? 0;
    return have >= need;
}

function requiredTierForFeature(feature) {
    if (ENTERPRISE_ONLY_FEATURES.includes(feature)) return 'enterprise';
    if (PRO_ONLY_FEATURES.includes(feature)) return 'pro';
    return 'free';
}

function requiresEnterprise(path) {
    return ENTERPRISE_NAV_ITEMS.some((p) => path.includes(p));
}

function requiresPremium(path) {
    return PRO_NAV_ITEMS.some((p) => path.includes(p));
}

async function initPremiumSystem() {
    await refreshPremiumState();

    window.addEventListener('popstate', () => refreshPremiumState());
    window.addEventListener('focus', () => refreshPremiumState());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshPremiumState();
    });

    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
        refreshPremiumState();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        refreshPremiumState();
    };
}

async function refreshPremiumState() {
    await checkPremiumStatus();
    applyPremiumGating();
    applyPremiumToSettingsCards();
    enforcePremiumPage();
    updatePremiumBadge();
}

async function checkPremiumStatus() {
    try {
        const response = await fetch('/api/premium/status', {
            credentials: 'include'
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const tier = normalizeTier(data.tier || data.plan);
        const isEnterprise = Boolean(data.isEnterprise) || tier === 'enterprise';
        const isPremium = Boolean(data.isPremium) || isEnterprise || tier === 'pro';

        userPremiumStatus = {
            isPremium,
            isEnterprise,
            tier,
            expiresAt: data.expiresAt || null,
            features: buildTierFeatures(tier, data.features)
        };
    } catch (error) {
        console.warn('[Premium] Could not fetch premium status:', error);
        userPremiumStatus = {
            isPremium: false,
            isEnterprise: false,
            tier: 'free',
            expiresAt: null,
            features: [...FREE_FEATURES]
        };
    }
}

function hasFeatureAccess(feature) {
    return hasTierAccess(requiredTierForFeature(feature));
}

function getRequiredTierForNavItem(item) {
    const href = item.getAttribute('href') || '';
    const explicitEnterprise = item.dataset.enterpriseRequired === 'true';
    const explicitPremium = item.dataset.premiumRequired === 'true';

    if (explicitEnterprise || requiresEnterprise(href)) return 'enterprise';
    if (explicitPremium || requiresPremium(href)) return 'pro';
    return 'free';
}

function applyPremiumGating() {
    const navItems = document.querySelectorAll('.nav-item, .sidebar-nav a');

    navItems.forEach((item) => {
        const requiredTier = getRequiredTierForNavItem(item);
        const locked = requiredTier !== 'free' && !hasTierAccess(requiredTier);

        if (locked) {
            item.classList.add('premium-locked');
            item.dataset.premiumLocked = 'true';
            item.dataset.requiredTier = requiredTier;

            if (!item.querySelector('.premium-lock-icon')) {
                const lockIcon = document.createElement('i');
                lockIcon.className = 'fas fa-lock premium-lock-icon';
                lockIcon.title = `${requiredTier === 'enterprise' ? 'Enterprise' : 'Pro'} feature`;
                item.appendChild(lockIcon);
            }

            item.removeEventListener('click', handleLockedFeatureClick);
            item.addEventListener('click', handleLockedFeatureClick);
        } else {
            item.classList.remove('premium-locked');
            item.dataset.premiumLocked = 'false';
            delete item.dataset.requiredTier;

            const lockIcon = item.querySelector('.premium-lock-icon');
            if (lockIcon) lockIcon.remove();
            item.removeEventListener('click', handleLockedFeatureClick);
        }
    });

    const upgradeNav = document.querySelector('.premium-upgrade-nav');
    if (upgradeNav) {
        upgradeNav.style.display = userPremiumStatus.isPremium ? 'none' : '';
    }
}

function enforcePremiumPage() {
    const path = window.location.pathname || '';
    const bodyRequiresEnterprise = document.body?.dataset?.enterprisePage === 'true';
    const bodyRequiresPremium = document.body?.dataset?.premiumPage === 'true';

    const requiredTier = bodyRequiresEnterprise || requiresEnterprise(path)
        ? 'enterprise'
        : (bodyRequiresPremium || requiresPremium(path) ? 'pro' : 'free');

    if (requiredTier === 'free') {
        unlockPremiumPage();
        return;
    }

    if (hasTierAccess(requiredTier)) {
        unlockPremiumPage();
        return;
    }

    lockPremiumPage(requiredTier);
}

function lockPremiumPage(requiredTier) {
    document.body.classList.add('premium-page-locked');

    document.querySelectorAll('input, select, button, textarea').forEach((input) => {
        input.disabled = true;
        input.classList.add('premium-disabled');
    });

    document.querySelectorAll('form').forEach((form) => {
        form.addEventListener('submit', preventPremiumSubmit, true);
    });

    document.removeEventListener('click', preventPremiumInteraction, true);
    document.removeEventListener('keydown', preventPremiumInteraction, true);
    document.addEventListener('click', preventPremiumInteraction, true);
    document.addEventListener('keydown', preventPremiumInteraction, true);

    const heading = requiredTier === 'enterprise' ? 'Enterprise Feature' : 'Pro Feature';
    const cta = requiredTier === 'enterprise' ? 'Upgrade to Enterprise' : 'Upgrade to Pro';

    let overlay = document.getElementById('premiumPageOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'premiumPageOverlay';
        overlay.className = 'premium-page-overlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="premium-page-overlay-content">
            <div class="premium-icon"><i class="fas fa-crown"></i></div>
            <h2>${heading}</h2>
            <p>This page requires the ${requiredTier === 'enterprise' ? 'Enterprise' : 'Pro'} plan.</p>
            <button class="btn-upgrade" onclick="showUpgradeModal('${requiredTier}')">${cta}</button>
            <a class="btn-back" href="/dashboard">Back to Dashboard</a>
        </div>
    `;
}

function unlockPremiumPage() {
    document.body.classList.remove('premium-page-locked');

    const overlay = document.getElementById('premiumPageOverlay');
    if (overlay) overlay.remove();

    document.querySelectorAll('input, select, button, textarea').forEach((input) => {
        input.disabled = false;
        input.classList.remove('premium-disabled');
    });

    document.querySelectorAll('form').forEach((form) => {
        form.removeEventListener('submit', preventPremiumSubmit, true);
    });

    document.removeEventListener('click', preventPremiumInteraction, true);
    document.removeEventListener('keydown', preventPremiumInteraction, true);
}

function preventPremiumSubmit(event) {
    event.preventDefault();
    event.stopPropagation();
    showUpgradeModal('pro');
}

function preventPremiumInteraction(event) {
    if (!document.body.classList.contains('premium-page-locked')) return;
    const target = event.target;
    if (!target) return;
    if (target.closest('#premiumPageOverlay')) return;

    event.preventDefault();
    event.stopPropagation();
    showUpgradeModal('pro');
}

function applyPremiumToSettingsCards() {
    const premiumSettings = document.querySelectorAll('[data-premium-feature], [data-enterprise-feature]');

    premiumSettings.forEach((element) => {
        const feature = element.dataset.premiumFeature || '';
        const requiredTier = element.dataset.enterpriseFeature === 'true'
            ? 'enterprise'
            : requiredTierForFeature(feature);

        if (requiredTier !== 'free' && !hasTierAccess(requiredTier)) {
            element.classList.add('premium-locked-setting');

            const inputs = element.querySelectorAll('input, select, button, textarea');
            inputs.forEach((input) => {
                input.disabled = true;
                input.classList.add('premium-disabled');
            });

            if (!element.querySelector('.premium-overlay')) {
                const overlay = document.createElement('div');
                overlay.className = 'premium-overlay';
                overlay.innerHTML = `
                    <div class="premium-overlay-content">
                        <i class="fas fa-lock"></i>
                        <span>${requiredTier === 'enterprise' ? 'Enterprise' : 'Pro'} Feature</span>
                        <button class="btn-upgrade-small" onclick="showUpgradeModal('${requiredTier}')">Upgrade</button>
                    </div>
                `;
                element.style.position = 'relative';
                element.appendChild(overlay);
            }
        } else {
            element.classList.remove('premium-locked-setting');

            const overlay = element.querySelector('.premium-overlay');
            if (overlay) overlay.remove();

            const inputs = element.querySelectorAll('input, select, button, textarea');
            inputs.forEach((input) => {
                input.disabled = false;
                input.classList.remove('premium-disabled');
            });
        }
    });
}

function handleLockedFeatureClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const requiredTier = event.currentTarget?.dataset?.requiredTier === 'enterprise' ? 'enterprise' : 'pro';
    showUpgradeModal(requiredTier);
    return false;
}

let selectedPlan = 'pro';

function showUpgradeModal(requiredTier = 'pro') {
    let modal = document.getElementById('premiumUpgradeModal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'premiumUpgradeModal';
        modal.className = 'premium-modal';
        modal.innerHTML = `
            <div class="premium-modal-backdrop" onclick="closePremiumModal()"></div>
            <div class="premium-modal-content">
                <button class="premium-modal-close" onclick="closePremiumModal()">&times;</button>
                <div class="premium-modal-header">
                    <div class="premium-icon"><i class="fas fa-crown"></i></div>
                    <h2>Upgrade Your Plan</h2>
                    <p>Choose the plan that matches your server and team needs.</p>
                </div>
                <div class="premium-modal-body">
                    <div class="premium-features-grid">
                        <div class="premium-feature-item"><i class="fas fa-shield-alt"></i><span>Advanced Protection</span></div>
                        <div class="premium-feature-item"><i class="fas fa-ticket-alt"></i><span>Advanced Tickets & Modmail</span></div>
                        <div class="premium-feature-item"><i class="fas fa-chart-line"></i><span>Advanced Analytics</span></div>
                        <div class="premium-feature-item"><i class="fas fa-network-wired"></i><span>Multi-Server Connect (Enterprise)</span></div>
                    </div>
                    <div class="premium-pricing">
                        <div class="pricing-option" data-plan="pro" onclick="selectPlan('pro')">
                            <div class="pricing-label">Pro</div>
                            <div class="pricing-price">$5<span>/mo</span></div>
                            <div class="pricing-savings">1 selected server</div>
                        </div>
                        <div class="pricing-option recommended" data-plan="enterprise" onclick="selectPlan('enterprise')">
                            <div class="pricing-badge">Full Coverage</div>
                            <div class="pricing-label">Enterprise</div>
                            <div class="pricing-price">$50<span>/mo</span></div>
                            <div class="pricing-savings">Every server you are in</div>
                        </div>
                    </div>
                </div>
                <div class="premium-modal-footer">
                    <button class="btn-secondary" onclick="closePremiumModal()">Maybe Later</button>
                    <button class="btn-premium" onclick="startCheckout()">
                        <i class="fas fa-crown"></i>
                        Continue to Checkout
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const preferredPlan = requiredTier === 'enterprise' ? 'enterprise' : 'pro';
    selectPlan(preferredPlan);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePremiumModal() {
    const modal = document.getElementById('premiumUpgradeModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function selectPlan(plan) {
    selectedPlan = normalizeTier(plan) === 'enterprise' ? 'enterprise' : 'pro';
    document.querySelectorAll('.pricing-option').forEach((opt) => {
        opt.classList.toggle('selected', opt.dataset.plan === selectedPlan);
    });
}

async function startCheckout() {
    try {
        const guildId = window.currentGuildId || localStorage.getItem('selectedGuildId');
        if (selectedPlan === 'pro' && !guildId) {
            alert('Select a server first before purchasing Pro.');
            return;
        }

        const response = await fetch('/api/stripe/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                plan: selectedPlan,
                guildId: selectedPlan === 'enterprise' ? null : guildId
            })
        });

        const data = await response.json();

        if (data.error) {
            if (data.subscription) {
                alert(`You already have an active ${data.subscription.plan} subscription. It renews on ${new Date(data.subscription.renewsAt).toLocaleDateString()}.`);
            } else {
                alert(`Error: ${data.error}`);
            }
            return;
        }

        if (data.url) {
            window.location.href = data.url;
        }
    } catch (error) {
        console.error('[Premium] Checkout error:', error);
        alert('Failed to start checkout. Please try again.');
    }
}

function updatePremiumBadge() {
    // Badge display removed from bot dashboard
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        initPremiumSystem();
        updatePremiumBadge();
    }, 500);
});

window.PremiumSystem = {
    check: checkPremiumStatus,
    hasAccess: hasFeatureAccess,
    showUpgrade: showUpgradeModal,
    isPremium: () => userPremiumStatus.isPremium,
    isEnterprise: () => userPremiumStatus.isEnterprise,
    getStatus: () => userPremiumStatus,
    requiresPremium,
    requiresEnterprise
};
