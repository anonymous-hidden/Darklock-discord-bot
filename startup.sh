#!/bin/bash
set -e

echo "🚀 DarkLock Startup Sequence"
echo "=============================="

# Step 1: Validate critical environment variables
echo ""
echo "Step 1/4: Environment validation"
sh scripts/validate-env.sh || exit 1

# Step 2: Check Darklock Guard installer files (optional, warning only)
echo ""
echo "Step 2/4: Checking Darklock Guard installer files (optional)"
node darklock/check-downloads.js || echo "⚠️  Installer check skipped or failed (non-critical)"

# Step 3: Build Darklock Notes web app if dist is missing or stale
echo ""
echo "Step 3/5: Building Darklock Notes web app (PWA)"
NOTES_DIST="darklock-notes/apps/web/dist"
if [ ! -f "$NOTES_DIST/index.html" ]; then
    echo "  → dist not found, building now..."
    (cd darklock-notes && npm run build:web 2>&1) || echo "⚠️  Notes web build failed (non-critical)"
else
    echo "  → dist already built, skipping"
fi

# Step 4: Generate anti-tampering baseline
echo ""
echo "Step 4/5: Generating anti-tampering baseline"
node file-protection/agent/baseline-generator.js || {
    echo "⚠️  Baseline generation failed (continuing with existing baseline)"
}

# Step 5: Start the bot
echo ""
echo "Step 5/5: Starting DarkLock bot"
echo "=============================="
exec node src/bot.js
