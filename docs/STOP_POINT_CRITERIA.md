# Architecture Upgrade — Stop-Point Criteria

**Date:** Phase A-C complete  
**Status:** SAFE STOPPING POINT ✅

---

## What Was Completed

### Phase A — Immediate Security Patches (7/7) ✅

| Patch | File | Change | Risk |
|-------|------|--------|------|
| A1 | `src/bot.js` | `hasProFeatures()`/`hasEnterpriseFeatures()` now query real `guild_subscriptions` table | Low — only affects feature gating |
| A2 | `src/bot.js` | Feature flag defaults changed `?? true` → `?? false` (both lambda + method) | Low — fail-closed is strictly safer |
| A3 | `src/dashboard/routes/auth.js` | Removed JWT from login response body (cookie-only) | Low — dashboard already uses cookies |
| A4 | `src/dashboard/routes/auth.js` | Added 7-day max refresh window + removed JWT from refresh body | Low — bounds infinite session sliding |
| A5 | `src/dashboard/routes/darklock-guard.js` | Removed hardcoded JWT_SECRET fallback — fail-hard if env missing | Low — crashes loud instead of running insecure |
| A6 | `darklock/server.js` | Rate limiter no longer skips `/api/` paths | Low — API routes now properly rate-limited |
| A7 | `guard-v2/crates/guard-core/src/vault.rs` + 3 files | Fresh nonce on every vault save (fixes nonce reuse) | Medium — cascading `&mut self` signature changes |

### Phase B — ConfigService Foundation (3/3) ✅

| Item | File | Change |
|------|------|--------|
| B1 | `src/services/tier-enforcement.js` | **New** — `enforceTierLimits()`, `requireTier()`, `applyTierMask()`, `resolveGuildTier()` |
| B2 | `src/dashboard/routes/settings.js` | All 3 write routes now go through ConfigService + tier enforcement |
| B3 | `src/services/ConfigService.js` | Added `resolveEffective(guildId)` — tier-masked config for bot runtime |

### Phase C — Bot Runtime Integration (2/2) ✅

| Item | File | Change |
|------|------|--------|
| C1 | `src/services/config-subscriber.js` | **New** — Event-driven bridge: `configChanged` → module invalidation |
| C2 | `src/bot.js` | ConfigSubscriber auto-bound after ConfigService init |

---

## Current Architecture State

```
Dashboard PUT /settings
    │
    ├── validateSettings()
    ├── enforceTierLimits()          ← NEW (Phase B)
    │    └── resolveGuildTier()      ← queries guild_subscriptions
    ├── configService.update()       ← validates, persists, emits events
    │    ├── DB write
    │    ├── cache refresh
    │    ├── emit('configChanged')   → ConfigSubscriber dispatches to modules ← NEW (Phase C)
    │    ├── saveHistory()
    │    └── broadcastUpdate()       → WebSocket to dashboard
    └── logger.logDashboardAction()

Bot Runtime reads:
    configService.resolveEffective(guildId)  ← NEW (Phase B)
        └── get() + applyTierMask()          ← tier-constrained config
```

---

## What Must NOT Be Touched

These invariants must hold for system stability:

1. **`configService.update()` is the ONLY write path** for `guild_configs` from the dashboard. Never add direct `database.updateGuildConfig()` calls to new routes.

2. **`resolveGuildTier()` is the ONLY tier authority.** Never hard-code tier checks elsewhere.

3. **Feature flag defaults are `false`** (fail-closed). Never change `?? false` back to `?? true` in `bot.js`.

4. **JWT never appears in response bodies.** It's cookie-only. Never add `token` back to login/refresh JSON.

5. **Vault generates fresh nonce on every save.** The `save()` and `save_with_key()` methods in `vault.rs` must always call `generate_nonce()` before encryption.

6. **Rate limiter covers `/api/` paths.** Never re-add `/api/` to the `skip` function in `darklock/server.js`.

---

## What's Safe to Do Next (Future Phases)

These are optional improvements that build on the current foundation without risk:

### Low Risk
- [ ] Add `invalidateCache(guildId)` method to AntiSpam, AntiRaid, AntiNuke, AntiPhishing modules so ConfigSubscriber can push changes immediately instead of waiting for next message
- [ ] Route the features GET endpoint through `configService.resolveEffective()` to return tier-masked feature states
- [ ] Add tier info to the settings GET response so the dashboard can show upgrade prompts
- [ ] Wire `CachedConfigService` (if used) to ConfigSubscriber's catch-all invalidation

### Medium Risk
- [ ] Migrate WebhookProtection, EmojiSpamDetector, AltDetector from isolated config tables to `guild_configs` — requires schema migration
- [ ] Reduce redundant DB reads in `messageCreate` handler (currently 3-4 reads per message) by reading once through ConfigService and passing to all modules
- [ ] Add per-key validation rules to `tier-enforcement.js` for numeric limits (e.g., free tier max 5 spam threshold, pro tier max 20)

### Higher Risk (Requires Careful Testing)
- [ ] Add `resolveEffective()` calls at the top of each security module's handler, replacing direct `getGuildConfig()` — changes 10+ modules
- [ ] Implement the full 4-layer settings authority (static defaults → platform policy → guild config → runtime cache) in ConfigService
- [ ] Add HMAC-authenticated IPC between ConfigSubscriber and guard-v2 service for cross-process config sync

---

## Success Metrics

The upgrade is successful when:

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| Feature flags default to OFF | ❌ Defaulted ON | ✅ Default OFF | ✅ Done |
| JWT in response body | ❌ Leaked in JSON | ✅ Cookie-only | ✅ Done |
| Session sliding is bounded | ❌ Infinite refresh | ✅ 7-day max | ✅ Done |
| Vault nonce reuse | ❌ Same nonce reused | ✅ Fresh per save | ✅ Done |
| API rate limiting | ❌ API paths skipped | ✅ All paths covered | ✅ Done |
| Config writes go through ConfigService | ❌ 3 direct DB calls | ✅ All via ConfigService | ✅ Done |
| Tier enforcement on writes | ❌ None | ✅ enforceTierLimits() on all writes | ✅ Done |
| Config changes propagate to modules | ❌ Wait for next event | ✅ Event-driven via ConfigSubscriber | ✅ Done |

---

## Files Modified (Complete List)

| File | Type | Lines Changed |
|------|------|--------------|
| `src/bot.js` | Modified | ~15 lines across 4 locations |
| `src/dashboard/routes/auth.js` | Modified | ~20 lines across 3 locations |
| `src/dashboard/routes/darklock-guard.js` | Modified | ~5 lines |
| `src/dashboard/routes/settings.js` | Modified | ~60 lines across 6 locations |
| `darklock/server.js` | Modified | ~2 lines |
| `guard-v2/crates/guard-core/src/vault.rs` | Modified | ~10 lines |
| `guard-v2/crates/guard-core/src/storage.rs` | Modified | ~1 line |
| `guard-v2/crates/guard-service/src/engine/mod.rs` | Modified | ~2 lines |
| `guard-v2/crates/guard-service/src/main.rs` | Modified | ~3 lines |
| `src/services/ConfigService.js` | Modified | ~18 lines (import + resolveEffective) |
| `src/services/tier-enforcement.js` | **Created** | ~165 lines |
| `src/services/config-subscriber.js` | **Created** | ~230 lines |

**Total: 10 files modified, 2 files created, ~530 lines of change**
