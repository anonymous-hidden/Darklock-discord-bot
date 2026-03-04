# Darklock Platform — Architecture Upgrade Plan

> **Author:** Architecture Review  
> **Date:** 2026-02-05  
> **Status:** Ready for implementation  
> **Scope:** Cross-component architecture, enforcement model, security review

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Assessment](#current-state-assessment)
3. [Phase 1 — Architecture Analysis](#phase-1--architecture-analysis)
4. [Phase 2 — Enforcement Model](#phase-2--enforcement-model)
5. [Phase 3 — Tauri + Backend Integration](#phase-3--tauri--backend-integration)
6. [Phase 4 — Security Review](#phase-4--security-review)
7. [Implementation Priority Matrix](#implementation-priority-matrix)

---

## Executive Summary

The Darklock platform has strong cryptographic foundations (Ed25519 signing, XChaCha20-Poly1305 vault encryption, HMAC-authenticated IPC) but suffers from **architectural fragmentation**: settings live in 4+ locations with no synchronization, two independent device management systems exist with no awareness of each other, premium enforcement is disabled at the bot layer, and the desktop app operates as a fully isolated product with no shared data contract with the web dashboard.

This plan addresses these issues through five focused interventions:

1. **Unified Settings Authority** — Single API that all components read from
2. **Server-Side Enforcement Gate** — All policy/tier/role checks happen at the API boundary
3. **Real-Time Config Propagation** — WebSocket-driven push instead of polling
4. **Tauri Trust Model** — Desktop app enforces via Rust service, never via JS frontend
5. **Security Hardening** — Fix vault nonce reuse, token lifecycle, session persistence, CSRF unification

---

## Current State Assessment

### What Exists Today (Component Map)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DARKLOCK PLATFORM                            │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │ Discord Bot   │   │ Web Dashboard│   │ Desktop App (Tauri v2)  │ │
│  │ (Node.js)     │   │ (Express)    │   │ ┌───────┐ ┌──────────┐ │ │
│  │               │   │              │   │ │JS     │ │Rust      │ │ │
│  │ • Commands    │   │ • Settings UI│   │ │Front  │ │Service   │ │ │
│  │ • Events      │   │ • Features   │   │ │       │ │          │ │ │
│  │ • Security    │   │ • Analytics  │   │ │ Tauri  │ │ guard-   │ │ │
│  │   modules     │   │ • Guard UI   │   │ │ IPC   │ │ service  │ │ │
│  │ • ConfigSvc   │   │ • WebSocket  │   │ │ ───►  │ │ ───►     │ │ │
│  │               │   │              │   │ │invoke │ │ UDS IPC  │ │ │
│  └──────┬────────┘   └──────┬───────┘   │ └───────┘ └──────────┘ │ │
│         │                   │           └─────────────────────────┘ │
│         ▼                   ▼                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │ SQLite        │   │ Darklock     │   │ Platform API            │ │
│  │ guild_configs │   │ Server :3002 │   │ (Express+PG) :4000      │ │
│  │ 80+ columns   │   │ Admin RBAC   │   │ Device mgmt, releases   │ │
│  └──────────────┘   └──────────────┘   └─────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Guard-v2 Rust Crates                                         │   │
│  │ guard-core: vault, crypto, event_log, ipc, settings          │   │
│  │ guard-service: engine, connected mode, status server          │   │
│  │ updater-helper: binary update pipeline                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Critical Problems Identified

| # | Problem | Severity | Where |
|---|---------|----------|-------|
| 1 | **Settings in 4+ locations** with no sync | 🔴 Critical | config.json, guild_configs SQLite, vault.dat, Platform API PG |
| 2 | **Premium paywall disabled** — `hasProFeatures()` always returns `true` | 🔴 Critical | src/database/database.js |
| 3 | **Two parallel device management systems** with different DBs | 🔴 Critical | darklock-guard.js (SQLite) vs platform/api (PostgreSQL) |
| 4 | **Three auth cookie names** across subsystems | 🟡 High | `darklock_token`, `auth_token`, `device_token` |
| 5 | **In-memory sessions/CSRF/rate-limits** lost on restart | 🟡 High | session stores, link codes, nonce books |
| 6 | **No shared type contract** between Node.js and Rust | 🟡 High | GuardSettings (Rust) vs guild_configs (SQLite) are unrelated schemas |
| 7 | **Feature toggles default to `true`** when undefined (fail-open) | 🟡 High | canonical-systems.js featureFlags |
| 8 | **Connected mode has no retry/backoff** | 🟡 High | guard-service/connected/ heartbeat + polling |
| 9 | **Vault nonce reuse** on re-save with same password | 🟠 Medium | vault.rs — same key+nonce for XChaCha20 |
| 10 | **NonceBook unbounded memory** growth in connected mode | 🟠 Medium | guard-service nonce_book grows forever |
| 11 | **Two CSRF systems** with unclear activation | 🟠 Medium | security-utils.js vs security-helpers.js |
| 12 | **Rate limiting skips all `/api/` paths** in darklock server | 🟠 Medium | darklock/server.js |
| 13 | **No watcher/scan engine** in guard-service — settings-only CRUD | 🟠 Medium | engine/mod.rs |
| 14 | **get_events() returns empty Vec** — event log never surfaced | 🟠 Medium | main.rs Tauri commands |

---

## Phase 1 — Architecture Analysis

### 1.1 Single Source of Truth for Settings

**Problem:** Settings exist in `config.json` (static defaults), `guild_configs` SQLite (80+ columns), `VaultConfig`/`GuardSettings` (Rust structs), and Platform API PostgreSQL (device config). No single component knows the full truth.

**Design: Tiered Settings Authority**

```
                    AUTHORITY HIERARCHY
                    
    ┌─────────────────────────────────────────┐
    │         Layer 4: STATIC DEFAULTS         │
    │  config.json / GuardSettings::default()  │
    │  • Loaded once at startup                │
    │  • Never changes at runtime              │
    │  • Fallback when DB is unavailable       │
    └──────────────────┬──────────────────────┘
                       │ overridden by
    ┌──────────────────▼──────────────────────┐
    │       Layer 3: PLATFORM POLICY           │
    │  Platform API → guild_subscriptions      │
    │  • Tier limits (free/pro/enterprise)     │
    │  • Org-wide policies                     │
    │  • Cannot be overridden by guild admin   │
    └──────────────────┬──────────────────────┘
                       │ constrained by
    ┌──────────────────▼──────────────────────┐
    │       Layer 2: GUILD CONFIGURATION       │
    │  guild_configs SQLite table               │
    │  • Per-guild feature toggles             │
    │  • Thresholds, channel mappings          │
    │  • Admin-configurable within tier limits │
    └──────────────────┬──────────────────────┘
                       │ synced to
    ┌──────────────────▼──────────────────────┐
    │       Layer 1: RUNTIME STATE             │
    │  ConfigService cache / Vault KV          │
    │  • In-memory, fast reads                 │
    │  • WebSocket-pushed on change            │
    │  • Never authoritative — always derived  │
    └──────────────────────────────────────────┘
```

**Key Principle:** Every setting read goes through `ConfigService.get(guildId)`, which:
1. Checks in-memory cache (Layer 1)
2. Falls back to DB (Layer 2)
3. Applies tier constraints from subscription (Layer 3)
4. Falls back to static defaults (Layer 4)

**Implementation changes required:**

| File | Change |
|------|--------|
| `src/services/ConfigService.js` | Add `resolveEffective(guildId)` that merges Layer 2 settings with Layer 3 tier constraints. If a guild on Free tier has `ai_enabled: true` in DB, the effective value is `false` because Free tier doesn't include AI. |
| `src/database/database.js` | Re-enable `hasProFeatures()` / `hasEnterpriseFeatures()` to query real subscription state. Remove the `return true` override. |
| `config.json` | Rename to `config.defaults.json`. Make it clear this is a fallback template, not runtime config. |
| `guard-v2/.../settings.rs` | Add `synced_guild_settings: Option<HashMap<String, serde_json::Value>>` to `VaultPayload` for offline cache of the guild config that was last synced from the server. |

**For the desktop app specifically:**

The desktop `GuardSettings` (security_mode, protection, performance, updates, privacy) is a different domain from guild bot settings. This is correct — they serve different purposes. The connection is through `Connected Mode`:

```
  Dashboard                     Platform API              Guard-Service
  ───────────                   ────────────              ─────────────
  User changes                  POST /commands            Command polled
  guild setting  ──────────►    {type: "UPDATE_POLICY",   ──────────►
                                 payload: {...}}           Engine applies
                                                           new settings
                                                           to vault
```

### 1.2 Secure Settings Flow

**Required flow for every settings change:**

```
┌──────┐   ┌──────────┐   ┌─────────────┐   ┌──────────┐   ┌────────────┐
│  UI  │──►│ API      │──►│ Validation  │──►│ Storage  │──►│ Propagation│
│      │   │ Endpoint │   │ Pipeline    │   │ (DB)     │   │            │
└──────┘   └──────────┘   └─────────────┘   └──────────┘   └────────────┘
              │                 │                │               │
              │ 1. Auth         │ 2. Schema      │ 3. Write     │ 4. Push
              │    (JWT)        │    validate     │    to SQLite │    via WS
              │ 2. CSRF         │ 3. Tier-gate    │ 4. Version   │    to bot
              │    check        │    (is this     │    hash      │    runtime
              │ 3. Role         │    feature      │ 5. Audit     │    + desktop
              │    check        │    allowed on   │    log       │    via IPC
              │ 4. Guild        │    their plan?) │              │
              │    access       │ 4. Range/type   │              │
              │                 │    validation   │              │
              │                 │ 5. Sanitize     │              │
```

**What must change to implement this:**

The current `PUT /guilds/:guildId/settings` route (in `src/dashboard/routes/settings.js`) does steps 1, 2 (partial), 3, but:
- **Missing:** Tier-gating in the validation pipeline. A free-tier guild admin can currently enable `ai_enabled: true` because `hasProFeatures()` returns `true`.
- **Missing:** Propagation step. After DB write, `ConfigService.emit('configChanged')` fires but nothing pushes to the desktop app.
- **Missing:** Version conflict detection. Two admins editing simultaneously → last write wins silently.

**Required additions to `settings.js`:**

```
// BEFORE saving to DB, add this gate:
const tierCheck = await enforceTierLimits(guildId, updates);
if (tierCheck.blocked.length > 0) {
    return res.status(403).json({
        error: 'Feature not available on your plan',
        blocked: tierCheck.blocked,
        requiredTier: tierCheck.requiredTier
    });
}

// AFTER saving to DB, add this propagation:
dashboard.configService.invalidateCache(guildId);
dashboard.wsHandler.broadcastToGuild(guildId, 'config_update', {
    keys: Object.keys(updates),
    version: newVersion
});
```

### 1.3 Real-Time Configuration Update System

**Current state:**
- `ConfigService` has a 5-minute cache TTL — stale reads are possible
- `WebSocketHandler` can broadcast `config_update` but it's only called from `ConfigService.update()`, not from all config-mutating routes
- Desktop app has no config push — it polls status every 1 second but doesn't receive config changes
- Bot security modules read config per-event from `getGuildConfig()` which goes to DB, not through `ConfigService`

**Proposed: Event-Driven Config Bus**

```
                   CONFIG BUS (EventEmitter)
                         │
         ┌───────────────┼───────────────────┐
         │               │                   │
    ┌────▼────┐    ┌─────▼─────┐    ┌────────▼────────┐
    │WebSocket│    │Bot Runtime│    │Platform API      │
    │Push to  │    │Hot-reload │    │Notify connected  │
    │dashboard│    │modules    │    │desktop devices   │
    │clients  │    │           │    │via command queue  │
    └─────────┘    └───────────┘    └─────────────────┘
```

**Implementation:**

**A. Centralize all config mutations through ConfigService:**

Every route that writes to `guild_configs` must go through `ConfigService.update()` instead of calling `database.updateGuildConfig()` directly. This ensures the event bus fires for every change.

Files that currently bypass ConfigService and write directly to DB:
- `src/dashboard/routes/settings.js` — `dashboard.bot.database.updateGuildConfig(guildId, updates)` on line ~63
- `src/dashboard/routes/settings.js` — feature toggle on line ~153
- `src/dashboard/routes/settings.js` — thresholds update on line ~222

**B. Bot runtime module hot-reload:**

Each security module (antispam, antiraid, etc.) should subscribe to config changes for its feature flag:

```javascript
// In each security module's constructor:
this.bot.configService.on('configChanged', ({ guildId, key, newValue }) => {
    if (key === 'anti_spam_enabled' && this.guildStates.has(guildId)) {
        if (!newValue) {
            this.guildStates.delete(guildId); // disable immediately
        }
    }
});
```

This replaces the current per-event DB check pattern where each message handler does `getGuildConfig(guildId)` → check `anti_spam_enabled`. The per-event pattern is correct for fresh guilds but wasteful for known guilds.

**C. Desktop app config push:**

For connected desktop devices, config changes should be queued as a `POLICY_UPDATE` command via the Platform API. The guard-service already polls for commands — it would receive the policy update and apply it to its engine.

New IPC request type needed in `guard-core/src/ipc.rs`:

```rust
IpcRequest::UpdatePolicy {
    policy_version: String,
    settings: serde_json::Value, // flexible schema
}
```

### 1.4 Trust Boundaries

**Principle: UI is a display layer. It never enforces security decisions.**

Current violations:

| Location | Violation | Fix |
|----------|-----------|-----|
| `darklock/public/js/pro-dashboard.js` | Client-side check for premium tabs — hides UI but doesn't block API | API routes must independently check tier |
| `darklock/public/js/paywall.js` | Page-level gating reads `data-premium` attribute — spoofable via DevTools | Server must render premium pages only for verified subscribers |
| `guard-v2/desktop/src/services/guard.ts` | Frontend reads `capabilities` and conditionally renders features | Already correct — Tauri invoke goes to Rust which enforces. But `get_events()` returns `[]` always, so the UI shows "no events" which is misleading |
| `canonical-systems.js` | Feature flags default to `true` when DB value is null/undefined | Change to `false` default (fail-closed) |

**Correct trust boundary architecture:**

```
┌─────────────────────────────────────────────────┐
│               UNTRUSTED ZONE                     │
│  • Browser JS (dashboard, paywall.js)            │
│  • Tauri WebView JS (React frontend)             │
│  • Discord user input                            │
│  • API request bodies                            │
│                                                  │
│  → MAY display, suggest, navigate                │
│  → MUST NOT decide access, enforce policy        │
└────────────────────┬────────────────────────────┘
                     │ HTTP / Tauri invoke / Discord event
                     ▼
┌─────────────────────────────────────────────────┐
│               TRUST BOUNDARY                     │
│  • JWT verification                              │
│  • CSRF validation                               │
│  • Role/permission check                         │
│  • Tier/subscription check                       │
│  • Input validation + sanitization               │
│  • Rate limiting                                 │
└────────────────────┬────────────────────────────┘
                     │ validated request
                     ▼
┌─────────────────────────────────────────────────┐
│               TRUSTED ZONE                       │
│  • ConfigService (settings logic)                │
│  • Database writes                               │
│  • Bot security modules (enforcement)            │
│  • Guard-service engine (Rust, file protection)  │
│  • Event log (signed chain)                      │
│  • Vault (encrypted at rest)                     │
└─────────────────────────────────────────────────┘
```

---

## Phase 2 — Enforcement Model

### 2.1 Feature Tier Enforcement

**Current state:** `hasProFeatures()` returns `true` for all guilds. The `TierService` in `src/services/ConfigService.js` defines correct tier boundaries but they're never enforced.

**Required: `TierEnforcementMiddleware`**

This middleware sits between route handlers and the database. It is the **only** place where tier logic runs.

```
                  TierEnforcementMiddleware
                  ─────────────────────────

  Input:  (guildId, settingKey, requestedValue)
  
  1. Load subscription: SELECT * FROM guild_subscriptions WHERE guild_id = ?
  2. Determine tier: 'free' | 'pro' | 'enterprise'
     - Check expiry: if pro_expires_at < now(), tier = 'free'
  3. Load tier definition from TierService.TIERS[tier]
  4. Check:
     a. Is settingKey a locked setting for this tier? → 403
     b. Is settingKey a feature not included in this tier? → 403
     c. Does the value exceed tier limits? → 403
  5. Pass through → next()
```

**Where to enforce:**

| Enforcement Point | How |
|-------------------|-----|
| **API routes** (settings.js, features toggle) | `tierEnforce(guildId, feature)` before DB write |
| **Bot commands** | Re-enable `hasProFeatures()` check in database.js. Change `return true` to real DB query |
| **Bot security modules** | `ConfigService.resolveEffective()` applies tier mask before returning config |
| **Dashboard page render** | Server-side template renders lock state based on real subscription, not client-side JS |

**Tier definition (canonical, from existing TierService):**

```
FREE:
  features: [antispam, antiraid, antinuke, linkprotection,
             verification, logging, welcome, moderation, tickets]
  limits: { protectedRoles: 3, customFilters: 5, backupSlots: 1 }
  locked: [securityMode, aiFeatures, advancedAnalytics,
           pushNotifications, apiAccess, whitelabel]

PRO ($9.99/mo):
  features: [everything in FREE + ai, analytics, apiAccess,
             advancedFilters, behaviorAnalysis, prioritySupport]
  limits: { protectedRoles: 25, customFilters: 50, backupSlots: 10 }
  locked: [whitelabel]

ENTERPRISE ($29.99/mo):
  features: [everything in PRO + whitelabel, sla,
             dedicatedSupport, customIntegrations]
  limits: { protectedRoles: unlimited, customFilters: unlimited,
            backupSlots: unlimited }
  locked: []
```

### 2.2 Role Enforcement

**Current state:** Three RBAC systems coexist:
1. Dashboard admin RBAC (`darklock/utils/rbac-middleware.js`) — rank-based, feature-rich
2. User dashboard auth (`src/dashboard/middleware/auth.js`) — JWT + Discord permissions
3. Bot command permissions (`src/core/canonical-systems.js`) — command allowlists

**Required: Unified Permission Model**

The three systems serve different audiences and should remain separate, but they must share a common permission vocabulary:

```
                    PERMISSION HIERARCHY
                    
    OWNER (rank 100)
      └─ Full platform access
      └─ Can manage admins, billing, RBAC
      └─ Can enter/exit safe mode
      └─ Can delete guild data
      
    ADMIN (rank 70-99)
      └─ Can configure security features
      └─ Can manage moderation settings
      └─ Can view audit logs
      └─ Cannot change billing or RBAC
      └─ Cannot manage other admins of equal/higher rank
      
    MODERATOR (rank 30-69)
      └─ Can use moderation commands
      └─ Can view logs (own actions only)
      └─ Cannot change settings
      └─ Read-only dashboard access
      
    USER (rank 0-29)
      └─ Can use public bot commands
      └─ Can view own warnings/history
      └─ No dashboard access
```

**Key enforcement rules:**

1. **Route-level:** Every API route declares its minimum rank or permission. The middleware checks before the handler runs.
2. **Never trust client role claims.** Role is always resolved server-side from the session/JWT → database lookup.
3. **Rank comparison must be strict:** A rank-70 admin cannot modify a rank-80 admin's settings. The current `requireMinRank()` in `rbac-middleware.js` already does this correctly.

### 2.3 Feature Locking That Cannot Be Bypassed

**Current bypass vectors:**

| Vector | How it works | Fix |
|--------|-------------|-----|
| **Direct API call** | User opens DevTools, sends `PUT /api/guilds/:id/settings` with `ai_enabled: true` on free tier | `TierEnforcementMiddleware` rejects at API boundary |
| **UI navigation** | User manually navigates to `/dashboard/analytics` on free tier; page renders because check is client-side | Server-side route guard returns 403 for premium pages |
| **State mismatch** | Guild's DB has `pro_enabled: 1` but subscription expired; cached config still says pro | `ConfigService.resolveEffective()` checks expiry on every read. Add `subscription_expires_at` to the cache and compare against `Date.now()` |
| **Config race** | Admin A sets feature on, Admin B sets it off simultaneously; WebSocket push shows stale state | Add `config_version` (monotonic integer) to `guild_configs`. API rejects writes where the submitted version doesn't match current version (optimistic locking) |
| **Offline bypass (desktop)** | User disconnects desktop from server; local vault retains settings that were revoked server-side | Guard-service must enforce a `policy_expires_at` timestamp. If connected mode can't reach the server for >24h, disable premium-tier features locally |

**Implementation for offline policy expiry (Rust side):**

Add to `VaultPayload`:
```rust
pub policy_expires_at: Option<DateTime<Utc>>,
pub policy_tier: String, // "free" | "pro" | "enterprise"
```

In the engine's settings enforcement:
```rust
fn enforce_tier_limits(&self, settings: &GuardSettings) -> GuardSettings {
    let tier = if let Some(expires) = self.vault.payload.policy_expires_at {
        if Utc::now() > expires {
            "free" // expired → degrade to free
        } else {
            &self.vault.payload.policy_tier
        }
    } else {
        "free" // no policy → free
    };
    
    let mut effective = settings.clone();
    if tier == "free" {
        effective.protection.baseline_locked = false; // pro feature
        // ... apply other free-tier constraints
    }
    effective
}
```

### 2.4 Offline vs Connected Mode Restrictions

**Current state:** `connected` is a boolean in `ServiceState`. Connected mode spawns heartbeat + command polling. No degraded-mode enforcement.

**Required enforcement matrix:**

| Capability | Connected Mode | Offline Mode |
|-----------|---------------|--------------|
| File monitoring (realtime) | ✅ | ✅ |
| Event logging (local) | ✅ | ✅ |
| Policy updates from server | ✅ | ❌ |
| Remote safe mode commands | ✅ | ❌ |
| Automatic updates | ✅ | ❌ Manual only |
| Dashboard visibility | ✅ (live status) | ❌ Last-known |
| Premium features | ✅ Enforced live | ⏳ Until `policy_expires_at` |
| Event sync to server | ✅ Batched upload | 📦 Queued locally |

**Implementation:** Add `ConnectionState` enum to replace the boolean:

```rust
pub enum ConnectionState {
    Connected {
        last_heartbeat: DateTime<Utc>,
        session_id: String,
    },
    Degraded {
        // Server unreachable but was recently connected
        last_successful_heartbeat: DateTime<Utc>,
        retry_count: u32,
    },
    Offline {
        // Intentionally disconnected or never connected
        reason: String,
    },
}
```

### 2.5 Policy Enforcement in Rust Service (Not Frontend)

**Current state:** The Tauri `main.rs` exposes commands like `get_settings()`, `update_settings()`, `get_capabilities()`. The JS frontend calls these and renders accordingly. The Rust service validates settings in `engine.update_settings()`. This is correct.

**Gap:** The frontend's `ServiceProvider` polls status every 1 second and uses the response to conditionally render pages. This is a display concern and is acceptable. But capabilities are hardcoded:

```rust
fn map_capabilities(state: &DeviceState) -> CapabilityMap {
    CapabilityMap {
        updates: state.updates.is_some(),
        events: false,      // hardcoded false
        scans: false,       // hardcoded false
        device_control: false, // hardcoded false
        connected_mode: state.connected,
    }
}
```

**Required:** Capabilities must be derived from actual service state + tier:

```rust
fn map_capabilities(state: &DeviceState, tier: &str) -> CapabilityMap {
    CapabilityMap {
        updates: state.updates.is_some(),
        events: true,  // event log exists, always available
        scans: tier != "free",  // scans are a pro feature
        device_control: tier == "enterprise",
        connected_mode: state.connected,
    }
}
```

---

## Phase 3 — Tauri + Backend Integration

### 3.1 Required IPC Commands

**Current Tauri commands (10):**

| Command | Status | Issue |
|---------|--------|-------|
| `get_status` | ✅ Working | — |
| `get_settings` | ✅ Working | — |
| `update_settings` | ✅ Working | No tier enforcement |
| `get_capabilities` | ⚠️ Partial | Hardcoded false for events/scans/device_control |
| `get_events` | ❌ Stub | Returns empty `Vec` always |
| `get_device_state` | ✅ Working | — |
| `trigger_scan` | ❌ Stub | Returns error |
| `update_check` | ❌ Stub | Returns `{available: false}` |
| `update_install` | ❌ Stub | Returns error |
| `update_rollback` | ❌ Stub | Returns error |

**Required new Tauri commands:**

| Command | Purpose | IPC Request |
|---------|---------|-------------|
| `get_event_log(page, severity_filter)` | Surface event log to UI with pagination | New `IpcRequest::GetEvents { offset, limit, min_severity }` |
| `get_policy_status()` | Show current policy tier + expiry | Read from vault payload |
| `sync_policy()` | Force immediate policy sync with server | Trigger connected mode command poll |
| `enter_safe_mode(reason)` | Already exists in IPC but not in Tauri commands | Wire existing `IpcRequest::EnterSafeMode` |
| `exit_safe_mode(password)` | Already exists in IPC but not in Tauri commands | Wire existing `IpcRequest::ExitSafeMode` |
| `get_connection_state()` | Show detailed connection status (not just bool) | Read from service state |
| `link_device(code)` | Initiate device linking from desktop | New flow via Platform API |
| `unlink_device()` | Remove server link | Clear connection from vault |

**IPC protocol additions for guard-core:**

```rust
// Add to IpcRequest enum:
GetEvents {
    offset: u64,
    limit: u64,
    min_severity: Option<EventSeverity>,
},
GetConnectionState,
SyncPolicy,
LinkDevice { code: String },
UnlinkDevice,

// Add to IpcResponse enum:
Events {
    entries: Vec<EventEntry>,
    total: u64,
},
ConnectionState {
    state: ConnectionStateInfo,
},
PolicySynced {
    tier: String,
    expires_at: Option<DateTime<Utc>>,
},
DeviceLinked {
    device_id: String,
    user_id: String,
},
DeviceUnlinked,
```

### 3.2 Settings Synchronization Model

**Two distinct setting scopes must be synchronized independently:**

**A. Guard Settings (Desktop-local)**

These are device-specific protection settings: `security_mode`, `realtime_enabled`, `baseline_locked`, `max_cpu_percent`, etc. They live in the vault and are modified locally via `update_settings` IPC.

```
  SettingsPage (React)
       │
       │ invoke("update_settings", { settings })
       ▼
  Tauri Command (main.rs)
       │
       │ IpcRequest::UpdateSettings
       ▼
  Guard-Service (engine)
       │
       │ 1. Validate (engine.update_settings)
       │ 2. Apply tier constraints
       │ 3. Persist to vault
       │ 4. If connected → POST /devices/:id/event
       │    {type: "SETTINGS_CHANGED", data: {...}}
       ▼
  Done (response flows back up)
```

**B. Guild Policy (Server-authoritative)**

These are guild-level bot settings that the desktop app should know about (e.g., whether the guild has premium, what security posture is required). These flow from server → desktop only.

```
  Dashboard (web)
       │
       │ Admin changes guild settings
       ▼
  API → ConfigService → DB
       │
       │ POST /devices/:id/commands
       │ {type: "POLICY_UPDATE", payload: {...}}
       ▼
  Platform API (command queue)
       │
       │ guard-service polls every 15s
       ▼
  Guard-Service (connected/commands.rs)
       │
       │ 1. Verify signature
       │ 2. Apply policy to vault
       │ 3. Engine reconfigures
       │ 4. Report result
       ▼
  Vault updated, UI reflects on next poll
```

### 3.3 Watcher Lifecycle Control

**Current state:** The `Engine` struct in guard-service is a settings CRUD wrapper. No file watching or scanning exists.

**Required lifecycle:**

```
Engine Lifecycle States:

  ┌─────────┐     init()     ┌──────────┐    start()    ┌─────────┐
  │ Created │───────────────►│ Ready    │──────────────►│ Running │
  └─────────┘                └──────────┘               └────┬────┘
                                  ▲                          │
                                  │         stop()           │
                                  └──────────────────────────┘
                                  │
                              ┌───┴──────┐
                              │SafeMode  │ (all watchers paused,
                              │          │  only status IPC responds)
                              └──────────┘
```

**Engine should own:**

1. **FileWatcher** — inotify/FSEvents for protected paths
2. **BaselineManager** — hash-based file integrity checking
3. **ScanScheduler** — periodic full-disk or targeted scans
4. **PolicyEnforcer** — applies tier+settings to decide which watchers run

Each sub-component should implement a `Controllable` trait:

```rust
trait Controllable: Send + Sync {
    fn start(&self) -> Result<()>;
    fn stop(&self) -> Result<()>;
    fn is_running(&self) -> bool;
    fn reconfigure(&self, settings: &GuardSettings) -> Result<()>;
}
```

### 3.4 Event Log Exposure to UI (Safely)

**Current problem:** `get_events()` in Tauri `main.rs` returns an empty `Vec`. The `EventLog` in guard-core writes signed entries to a file but has no read API.

**Required additions to `EventLog`:**

```rust
impl EventLog {
    // New: Read events with pagination
    pub fn read_entries(
        &self,
        offset: u64,
        limit: u64,
        min_severity: Option<EventSeverity>,
    ) -> Result<(Vec<EventEntry>, u64)> {
        // Read from file, parse JSONL, filter, paginate
        // Return (entries, total_count)
    }
    
    // New: Verify chain integrity
    pub fn verify_chain(&self) -> Result<ChainVerification> {
        // Walk entries, verify each hash links to prev_hash
        // Verify each signature
        // Return first broken link if any
    }
}
```

**Security constraint:** The Tauri command must NOT expose raw file paths or signing keys. It returns sanitized `EventEntry` objects (timestamp, severity, event_type, data) without the cryptographic fields (hash, prev_hash, signature). Chain verification is a separate privileged command.

### 3.5 Preventing UI from Spoofing State

**Current protections (already good):**
- Tauri invoke is restricted to the bundled webview
- IPC between Tauri app and guard-service uses HMAC-authenticated sessions with monotonic nonces
- Guard-service runs as a separate process with its own permissions

**Additional protections needed:**

1. **Read-only commands must not accept parameters that influence security decisions.** Current `get_capabilities()` takes no params — good. `get_status()` takes no params — good.

2. **Write commands must validate at the service layer, not the Tauri layer.** Current `update_settings()` forwards directly to guard-service which validates — good.

3. **The frontend must not cache security-critical state.** The current `ServiceProvider` polls every 1s and stores state in React context. This is acceptable as a display cache, but the actual enforcement happens in the Rust service.

4. **`trigger_scan()` must validate scan type server-side:**
```rust
// In guard-service handler:
IpcRequest::TriggerScan { kind } => {
    // Validate kind is one of: "quick", "full", "custom"
    // Check if scans are enabled in current tier
    // Check if a scan is already running
    // Queue the scan
}
```

5. **Add request signing for sensitive Tauri commands.** For `enter_safe_mode`, `exit_safe_mode`, `unlink_device` — these should require the vault password as a parameter, verified by the service. `exit_safe_mode` already does this.

---

## Phase 4 — Security Review

### 4.1 Privilege Escalation Risks

| Risk | Location | Severity | Mitigation |
|------|----------|----------|------------|
| **Premium bypass** — `hasProFeatures()` always returns `true` | `src/database/database.js` | 🔴 Critical | Re-enable real subscription check. This is a one-line fix (remove the early `return true`). |
| **Admin role spoofing** — `auth_admin` cookie checked independently of session store | `darklock/routes/admin-*.js` | 🟡 High | Unify cookie names. All admin checks must go through `rbac-middleware.js` `authenticateAdmin()` which does DB lookup. |
| **Guild access check bypass** — `checkGuildAccess()` returns `true` for admin userId | `src/dashboard/security-helpers.js` | 🟡 High | Admin users should still scope to their managed guilds. Add explicit guild-admin mapping instead of blanket admin bypass. |
| **Feature toggle fail-open** — unknown features default to enabled | `src/core/canonical-systems.js` | 🟡 High | Change `featureFlags` default from `true` to `false`. Unknown features should be disabled. |
| **Rate limit bypass** — all `/api/` paths skip rate limiting | `darklock/server.js` | 🟡 High | Remove the path exclusion. Apply tier-aware rate limits to all API routes. |
| **Config export leaks** — `GET /guilds/:id/export` only strips `webhook_url` and `api_keys` | `src/dashboard/routes/settings.js` | 🟠 Medium | Add comprehensive sensitive field list: all `*_token`, `*_secret`, `*_key`, `*_password` columns. |

### 4.2 Replay and Tampering Risks

| Risk | Location | Severity | Mitigation |
|------|----------|----------|------------|
| **Event chain break on rotation** — `last_hash` resets to `CHAIN_START` after log rotation | `guard-core/event_log.rs` | 🟡 High | Save an anchor hash before rotation. New chain's first entry should reference the final hash of the previous file: `prev_hash = anchor_of_rotated_file`. |
| **NonceBook unbounded growth** — nonces accumulate forever in connected mode | `guard-service/connected/commands.rs` | 🟠 Medium | Add TTL-based eviction: nonces older than 24h can be removed since command expiry is 5min. |
| **IPC nonce is per-session, not per-device** — restarting the Tauri app creates a new session with nonce 0 | `guard-core/ipc.rs` | 🟠 Medium | Acceptable because each session has a unique session_id. But ensure session_id is cryptographically random (currently uses `Uuid::new_v4()` — good). |
| **JWT in response body** — login route returns JWT in both cookie AND JSON body | `src/dashboard/routes/auth.js` | 🟠 Medium | Remove JWT from response body. It should only be in the httpOnly cookie. Returning it in the body enables exfiltration via XSS. |
| **CSRF token in query param** — WebSocket connects with `?token=JWT` | `src/dashboard/websocket/handler.js` | 🟠 Medium | Tokens in URLs appear in server logs, referrer headers, and browser history. Use a one-time ticket system: POST to `/api/ws-ticket` → receive short-lived ticket → connect with ticket. |

### 4.3 Token Lifecycle Problems

| Problem | Location | Severity | Fix |
|---------|----------|----------|-----|
| **No token expiry enforcement** — JWT refresh endpoint accepts expired tokens | `src/dashboard/routes/auth.js` `/refresh` | 🔴 Critical | Add maximum refresh window (e.g., 7 days from issuance). After that, force re-login. Track `iat` (issued-at) and reject if `now - iat > MAX_REFRESH_WINDOW`. |
| **Connected mode token never refreshes** — `CONNECTED_API_TOKEN` read from env once | `guard-service/connected/` | 🟡 High | Add token refresh protocol: service requests new token from Platform API using device key signature. Platform API issues short-lived tokens (1h) with refresh capability. |
| **In-memory session store** — all sessions lost on restart | `src/dashboard/security-utils.js` | 🟡 High | Move session store to SQLite with a `sessions` table. On restart, valid sessions survive. Add cleanup job for expired sessions. |
| **Device link codes in memory** — server restart orphans in-progress links | `src/dashboard/routes/darklock-guard.js` | 🟠 Medium | Store link codes in SQLite `darklock_link_codes` table with expiry. Clean up expired codes periodically. |

### 4.4 Unsafe Trust Assumptions

| Assumption | Reality | Fix |
|------------|---------|-----|
| **JWT_SECRET is always set correctly** | `darklock-guard.js` falls back to `'darklock-secret-key-change-me'` | Fail-hard on missing JWT_SECRET. The `validateSecrets()` in `security-helpers.js` does this for the dashboard but `darklock-guard.js` has its own independent check with a weak fallback. Remove the fallback. |
| **SQLite is single-writer safe** | Multiple Node.js processes or the bot + dashboard may write simultaneously | Enable WAL mode (`PRAGMA journal_mode=WAL`) for concurrent read/write. Already may be set but should be verified. |
| **Vault password stays in memory safely** | `ServiceState` holds `password: Zeroizing<String>` — good for Rust. But `GUARD_VAULT_PASSWORD` env var is readable by any process with the same UID. | Document that `GUARD_VAULT_PASSWORD` is for CI/testing only. In production, always use interactive prompt. Add a check: if running as systemd service, reject env-based password. |
| **Client-side tier gating is sufficient** | DevTools can modify `data-premium` attributes, navigate to any route, call any API | Never sufficient. Always pair with server-side enforcement. The client-side gating is UX only. |

### 4.5 Configuration Desynchronization Risks

| Risk | Scenario | Mitigation |
|------|----------|------------|
| **Cache staleness** | ConfigService has 5-min TTL. Admin changes config, bot reads stale cache for up to 5 minutes. | Reduce TTL to 30s for security-critical settings. Or: use `configChanged` event to invalidate cache immediately (already emitted but not all consumers listen). |
| **Dashboard ↔ Bot drift** | Dashboard writes to DB, bot reads from cache. If bot hasn't refreshed, it enforces old config. | All config writes go through ConfigService which invalidates cache + emits event. Security modules subscribe to events for immediate effect. |
| **Desktop ↔ Server drift** | Desktop is offline for days. Server-side admin revokes premium. Desktop still runs with premium settings from vault. | `policy_expires_at` in vault. Guard-service checks expiry in engine enforcement. Default to free tier when policy is stale. |
| **Two device tables** | `darklock_devices` (SQLite) and `devices` (PostgreSQL) are independent. A device linked in one system is unknown to the other. | **Consolidate.** The Platform API (PostgreSQL) should be the authoritative device registry. Dashboard Guard routes should call the Platform API instead of maintaining a parallel SQLite table. |
| **Duplicate column names** | `anti_spam_enabled` vs `antispam_enabled` coexist. Feature toggles write to both but reads may check only one. | Migrate to canonical column names (underscore-separated). Add DB migration to copy values and drop duplicates. Update all read paths to use canonical names. |

---

## Implementation Priority Matrix

### Immediate (Week 1-2) — Security Fixes

These are bugs that create exploitable vulnerabilities today:

| # | Task | Effort | Files |
|---|------|--------|-------|
| 1 | **Re-enable `hasProFeatures()` real check** | 30min | `src/database/database.js` — remove the `return true` early exit |
| 2 | **Change feature flag default to `false`** (fail-closed) | 1hr | `src/core/canonical-systems.js` — change `enabled = config?.[column] ?? true` to `?? false` |
| 3 | **Remove JWT from login response body** | 15min | `src/dashboard/routes/auth.js` — remove `token` from JSON response |
| 4 | **Add max refresh window to token refresh** | 1hr | `src/dashboard/routes/auth.js` `/refresh` — check `iat` age |
| 5 | **Remove JWT_SECRET fallback** | 15min | `darklock/routes/darklock-guard.js` — remove `\|\| 'darklock-secret-key-change-me'` and fail-hard |
| 6 | **Fix rate limiting to include API paths** | 30min | `darklock/server.js` — remove `/api/` exclusion from rate limiter |
| 7 | **Fix vault nonce reuse on save** | 2hr | `guard-core/vault.rs` — generate new nonce on each `save()` call |

### Short-Term (Week 3-4) — Architecture Foundation

| # | Task | Effort | Files |
|---|------|--------|-------|
| 8 | **Route all config writes through ConfigService** | 4hr | `src/dashboard/routes/settings.js` — replace direct DB calls with `configService.update()` |
| 9 | **Add tier enforcement middleware to settings routes** | 4hr | New middleware + wire into settings.js, features toggle |
| 10 | **Move sessions to SQLite** | 4hr | `src/dashboard/security-utils.js` — replace in-memory Map with SQLite table |
| 11 | **Unify CSRF system** | 3hr | Remove duplicate CSRF in `security-utils.js`, use only `security-helpers.js` |
| 12 | **Add `read_entries()` to EventLog** | 3hr | `guard-core/event_log.rs` — JSONL reader with pagination |
| 13 | **Wire `get_events` Tauri command to real data** | 2hr | `guard-v2/desktop/src-tauri/src/main.rs` — call through IPC to service |
| 14 | **Add connected mode retry with exponential backoff** | 3hr | `guard-service/connected/heartbeat.rs` + `commands.rs` |

### Medium-Term (Week 5-8) — Integration

| # | Task | Effort | Files |
|---|------|--------|-------|
| 15 | **Consolidate device management** | 8hr | Remove `darklock_devices` SQLite table. Dashboard Guard routes call Platform API |
| 16 | **Add policy sync flow** (server → desktop) | 8hr | New `POLICY_UPDATE` command type, handler in guard-service |
| 17 | **Add `policy_expires_at` to vault** | 4hr | `guard-core/vault.rs`, engine enforcement |
| 18 | **Migrate duplicate DB columns** | 4hr | New migration: copy values, add canonical names, update read paths |
| 19 | **Add WebSocket ticket system** | 4hr | Replace `?token=` with POST-for-ticket → connect-with-ticket |
| 20 | **Add `ConnectionState` enum** | 3hr | Replace `connected: bool` in service state |
| 21 | **Wire safe mode commands to Tauri** | 2hr | Add `enter_safe_mode` / `exit_safe_mode` Tauri commands |
| 22 | **Implement token refresh for connected mode** | 6hr | Platform API token endpoint, guard-service refresh loop |

### Long-Term (Week 9+) — Completeness

| # | Task | Effort | Files |
|---|------|--------|-------|
| 23 | **Build file watcher engine** | 16hr+ | `guard-service/engine/` — inotify/FSEvents integration |
| 24 | **Build baseline manager** | 12hr+ | New crate or module — hash-based file integrity |
| 25 | **Build scan scheduler** | 8hr+ | Periodic scan infrastructure |
| 26 | **Add event chain anchoring to daily summary** | 4hr | Wire `anchor_daily()` to a cron/timer in guard-service |
| 27 | **Server-side dashboard page rendering for premium** | 8hr | Replace client-side `paywall.js` with server-rendered gate |
| 28 | **Add config version optimistic locking** | 4hr | Monotonic version counter, reject stale writes |

---

## Appendix A: Cookie Consolidation Plan

| Current Cookie | Used By | Target |
|----------------|---------|--------|
| `darklock_token` | Dashboard auth (`middleware.js`) | Keep — primary auth cookie |
| `auth_token` | Dashboard routes (`auth.js`) | **Migrate to `darklock_token`** |
| `device_token` / `darklock_device_token` | Guard routes | Keep — separate device auth context |

After migration: two cookies maximum. `darklock_token` for web sessions. `darklock_device_token` for desktop device auth.

---

## Appendix B: Unified Error Response Format

All API responses should follow a consistent format to prevent information leakage:

```json
// Success
{ "ok": true, "data": { ... } }

// Client error (4xx)
{ "ok": false, "error": "Human-readable message", "code": "TIER_LIMIT_EXCEEDED" }

// Server error (5xx)
{ "ok": false, "error": "Internal error", "code": "INTERNAL_ERROR" }
// Never expose stack traces, SQL errors, or internal paths in production
```

---

## Appendix C: Settings Flow Diagram (Target State)

```
  ┌─────────────┐        ┌──────────────┐        ┌──────────────────┐
  │ Web Dashboard│        │ Discord Bot  │        │ Desktop App      │
  │ (Browser)    │        │ (Node.js)    │        │ (Tauri+Rust)     │
  └──────┬───────┘        └──────┬───────┘        └──────┬───────────┘
         │                       │                       │
         │ PUT /settings         │                       │
         ▼                       │                       │
  ┌──────────────┐               │                       │
  │ API Layer    │               │                       │
  │ 1. Auth      │               │                       │
  │ 2. CSRF      │               │                       │
  │ 3. Tier gate │               │                       │
  │ 4. Validate  │               │                       │
  └──────┬───────┘               │                       │
         │                       │                       │
         ▼                       │                       │
  ┌──────────────┐               │                       │
  │ConfigService │               │                       │
  │ .update()    │               │                       │
  │ → DB write   │               │                       │
  │ → cache inv  │               │                       │
  │ → audit log  │               │                       │
  │ → emit event │───────────────┤                       │
  └──────┬───────┘               │                       │
         │                       │                       │
         │  WebSocket push       │  configChanged event  │
         ▼                       ▼                       │
  ┌──────────────┐  ┌────────────────┐                   │
  │ WS: config_  │  │ Security module│                   │
  │ update msg   │  │ reconfigures   │                   │
  │ → UI refresh │  │ immediately    │                   │
  └──────────────┘  └────────────────┘                   │
                                                         │
         Platform API: POST /commands                    │
         {type: "POLICY_UPDATE"}                         │
                    │                                    │
                    └────────────────────────────────────►│
                                                 guard-service
                                                 polls command
                                                 → verifies sig
                                                 → applies policy
                                                 → updates vault
                                                 → engine reconfigures
```

---

*End of Architecture Upgrade Plan*
