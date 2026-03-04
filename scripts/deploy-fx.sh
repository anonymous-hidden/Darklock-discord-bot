#!/bin/bash
# DarkLock FX Deploy Script
# Deploys the micro-interaction system to Pi5
# Run this when Pi5 is available at 192.168.50.150

set -e

PI_HOST="darklock@192.168.50.150"
PI_PASS="0131106761Cb"
PI_PATH="/home/darklock/discord-bot"
LOCAL_PATH="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== DarkLock FX Deployment ==="
echo "Local: $LOCAL_PATH"
echo "Remote: $PI_HOST:$PI_PATH"

# Test connectivity
echo "Testing connectivity..."
if ! sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$PI_HOST" "echo ok" >/dev/null 2>&1; then
    echo "❌ Cannot reach Pi5. Aborting."
    exit 1
fi
echo "✅ Connected"

# Deploy FX assets
echo "Deploying FX CSS..."
sshpass -p "$PI_PASS" scp -o StrictHostKeyChecking=no \
    "$LOCAL_PATH/src/dashboard/public/css/darklock-fx.css" \
    "$PI_HOST:$PI_PATH/src/dashboard/public/css/"

echo "Deploying FX JS..."
sshpass -p "$PI_PASS" scp -o StrictHostKeyChecking=no \
    "$LOCAL_PATH/src/dashboard/public/js/darklock-fx.js" \
    "$PI_HOST:$PI_PATH/src/dashboard/public/js/"

# Deploy website copies
echo "Deploying website FX copies..."
sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no "$PI_HOST" "mkdir -p $PI_PATH/website/css $PI_PATH/website/js"
sshpass -p "$PI_PASS" scp -o StrictHostKeyChecking=no \
    "$LOCAL_PATH/website/css/darklock-fx.css" \
    "$PI_HOST:$PI_PATH/website/css/"
sshpass -p "$PI_PASS" scp -o StrictHostKeyChecking=no \
    "$LOCAL_PATH/website/js/darklock-fx.js" \
    "$PI_HOST:$PI_PATH/website/js/"

# Deploy updated HTML pages
echo "Deploying updated HTML pages..."
PAGES=(
    "src/dashboard/views/index-modern.html"
    "src/dashboard/views/login.html"
    "src/dashboard/views/landing.html"
    "src/dashboard/views/help-modern.html"
    "src/dashboard/views/analytics-modern.html"
    "src/dashboard/views/tickets-enhanced.html"
    "src/dashboard/views/console.html"
    "src/dashboard/views/logs.html"
    "src/dashboard/views/updates.html"
    "src/dashboard/views/status.html"
    "src/dashboard/views/setup-security.html"
    "src/dashboard/views/setup-tickets.html"
    "src/dashboard/views/setup-moderation.html"
    "src/dashboard/views/setup-features.html"
    "src/dashboard/views/setup-antinuke-modern.html"
    "src/dashboard/views/setup-anti-raid.html"
    "src/dashboard/views/setup-anti-spam.html"
    "src/dashboard/views/setup-anti-phishing-modern.html"
    "src/dashboard/views/setup-welcome-goodbye-redesign.html"
    "src/dashboard/views/setup-notifications.html"
    "src/dashboard/views/setup-verification.html"
    "src/dashboard/views/setup-autorole.html"
    "src/dashboard/views/access-code.html"
    "src/dashboard/views/access-generator.html"
    "src/dashboard/views/access-share.html"
    "src/dashboard/views/command-permissions.html"
    "src/dashboard/views/web-verify.html"
    "src/dashboard/views/verify-2fa.html"
    "src/dashboard/views/site/index.html"
    "src/dashboard/views/site/features.html"
    "src/dashboard/views/site/pricing.html"
    "src/dashboard/views/site/security.html"
    "src/dashboard/views/site/documentation.html"
    "src/dashboard/views/site/status.html"
    "src/dashboard/views/site/support.html"
    "src/dashboard/views/site/bug-reports.html"
    "src/dashboard/views/site/privacy.html"
    "src/dashboard/views/site/terms.html"
    "src/dashboard/views/site/sitemap.html"
    "src/dashboard/views/site/add-bot.html"
    "src/dashboard/public/payment.html"
    "src/dashboard/public/payment-success.html"
    "src/dashboard/public/payment-failed.html"
    "darklock/admin-v4/views/dashboard.html"
    "website/index.html"
    "website/docs.html"
    "website/status.html"
    "website/register.html"
    "website/bug-report.html"
    "website/maintenance.html"
)

for page in "${PAGES[@]}"; do
    if [ -f "$LOCAL_PATH/$page" ]; then
        sshpass -p "$PI_PASS" scp -o StrictHostKeyChecking=no \
            "$LOCAL_PATH/$page" "$PI_HOST:$PI_PATH/$page"
        echo "  ✅ $page"
    else
        echo "  ⚠️  $page (not found locally)"
    fi
done

# Restart the bot
echo ""
echo "Restarting bot..."
sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no "$PI_HOST" "cd $PI_PATH && pkill -f 'node src/bot.js' 2>/dev/null; sleep 2; nohup node src/bot.js > logs/bot.log 2>&1 & echo 'Bot PID:' \$!"

echo ""
echo "=== ✅ DarkLock FX deployed successfully ==="
echo ""
echo "Effects included:"
echo "  • Cursor glow trail"
echo "  • 3D tilt cards with shine"
echo "  • Magnetic hover buttons"
echo "  • Ripple click effects"
echo "  • Scroll reveal animations"
echo "  • Number count-up animations"
echo "  • Spotlight hover on panels"
echo "  • Toast notification system (window.dlToast)"
echo "  • Confetti celebration (window.dlConfetti)"
echo "  • Floating particles network"
echo "  • Page progress bar"
echo "  • Sidebar proximity trail"
echo "  • Staggered entrance animations"
echo "  • Keyboard shortcuts (Ctrl+K, Ctrl+/, G→D, etc.)"
echo "  • Konami code → Matrix rain easter egg"
echo "  • Animated gradient text"
echo "  • Glowing card borders"
echo "  • Polished scrollbars"
echo "  • Login hexagon canvas + confetti on success"
echo "  • Brand SVG shield logo"
