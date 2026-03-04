# 🔒 DARKLOCK SECURITY AUDIT — PHASE 1

**Date:** 2026-02-05  
**Scope:** All security modules, event handlers, interaction handlers, config services  
**Status:** COMPLETE — Proceeding to Phase 2

---

## 1. ATTACK SURFACE MAP

```
                         ┌─────────────────────────────────────┐
                         │         DISCORD GATEWAY             │
                         │  (trusted, but user-content is not) │
                         └──────┬────────────┬────────────┬────┘
                                │            │            │
                    messageCreate    guildMemberAdd   interactionCreate
                                │            │            │
                         ┌──────▼──────┐  ┌──▼─────┐  ┌──▼──────────────┐
                         │ CONTENT     │  │ JOIN   │  │ INTERACTIONS     │
                         │ PIPELINE    │  │ GATE   │  │ (buttons,modals, │
                         │             │  │        │  │  slash commands)  │
                         │ AntiSpam ───┤  │AntiRaid│  │                  │
                         │ AutoMod  ───┤  │AltDet  │  │ verify_user_{id} │
                         │ LinkAnalyzr─┤  │Verif.  │  │ close_ticket     │
                         │ WordFilter──┤  │        │  │ risk_action_*    │
                         │ Toxicity ───┤  │        │  │ modmail_close    │
                         │ AntiPhish──┤  │        │  │ appeal_approve_* │
                         └─────────────┘  └────────┘  └─────────────────┘
                                │            │            │
                         ┌──────▼────────────▼────────────▼───┐
                         │         ENFORCEMENT LAYER          │
                         │  (delete, timeout, kick, ban,      │
                         │   lockdown, quarantine, role strip) │
                         └──────┬─────────────────────────────┘
                                │
                         ┌──────▼──────────────────────────────┐
                         │  ConfigService → DB → Dashboard WS  │
                         │  Audit trail, action_logs, history   │
                         └─────────────────────────────────────┘
```

### Trust Boundaries

| Boundary | Trusted Side | Untrusted Side |
|----------|-------------|----------------|
| Discord Gateway → Bot | User IDs, guild IDs, permissions | Message content, usernames, button custom IDs |
| ConfigService → Modules | Config values after validation | Raw DB values, unknown keys |
| Dashboard → API | Authenticated session | Request body, query params |
| Bot → Enforcement | Permission checks passed | Target user hierarchy, bot self-permissions |
| Button interaction → Handler | `interaction.user` identity | `customId` string content (spoofable) |

---

## 2. TOP VULNERABILITIES (Ranked)

### 🔴 CRITICAL (Exploit = immediate server compromise or bypass)

| # | Vulnerability | Location | Impact |
|---|-------------|----------|--------|
| C1 | **No `messageUpdate` handler** — ALL content security bypassed by editing messages | Missing file | Any user edits clean message → phishing/spam/malware. Zero detection. |
| C2 | **`verify_user_{id}` button has NO permission check** — any user can verify anyone | interactionCreate.js | Bot accounts auto-verify by clicking public button |
| C3 | **Verification brute-force via unlimited code resets** — click verify → try 5x → click again → repeat | interactionCreate.js + VerificationService | Verification gate is defeated with automation |
| C4 | **User-supplied regex executed unsandboxed** in AutoMod word filter | automod.js | Guild admin sets `(a+)+$` → bot event loop freezes → global DoS |
| C5 | **AntiNukeManager `_bindEvents()` called TWICE** — every handler fires double | AntiNukeManager.js:30 | Double bans, double restores, race conditions, data corruption |
| C6 | **Unbounded Maps — 15+ Maps across codebase never cleaned** | All security modules | Memory exhaustion DoS after days/weeks of uptime |
| C7 | **Cross-channel flood bypass** — spam detection is per-channel only | antispam.js | 4 msgs × 20 channels = 80 msgs in 10s, all under threshold |
| C8 | **SSRF via shortener expansion** — bot HTTP-fetches arbitrary URLs | antilinks.js, LinkAnalyzer.js | Attacker probes internal network via `http://169.254.169.254/` |
| C9 | **`modmail_close`/`modmail_claim` buttons have no permission check** | interactionCreate.js | Any user in channel can close/claim modmail tickets |
| C10 | **AntiNuke mitigate/ban has no owner/self/hierarchy check** | AntiNukeManager.js | Could attempt to ban guild owner or the bot itself |

### 🟠 HIGH (Exploit = partial bypass or privilege escalation)

| # | Vulnerability | Location | Impact |
|---|-------------|----------|--------|
| H1 | Context menu commands bypass all permission/feature/plan gates | interactionCreate.js | Unpermitted users execute privileged actions |
| H2 | Unicode homoglyph bypass for duplicate detection | antispam.js | Fullwidth/Cyrillic chars evade duplicate filter |
| H3 | `cleanup()` in AntiSpam is never auto-invoked | antispam.js | All 9 Maps grow indefinitely |
| H4 | Ticket close button — any user in channel can close | TicketManager.js | Evidence destruction by reported user |
| H5 | Config `||` vs `??` — setting threshold to 0 silently uses default | All modules | Admin cannot disable individual checks |
| H6 | `_triggerLockdown` deletes ALL webhooks including integrations | AntiNukeManager.js | GitHub/CI webhooks permanently destroyed |
| H7 | Maintenance check opens new SQLite connection per interaction | interactionCreate.js | File handle exhaustion under load |
| H8 | Prompt injection in BehaviorAnalysis OpenAI calls | BehaviorAnalysis.js | Attacker manipulates AI scoring via crafted messages |
| H9 | `sessionStore` Map has no TTL or max size | security-utils.js | Memory leak + sessions never expire server-side |
| H10 | 3 security modules are dead code (WebhookProtection, EmojiSpam, AltDetector) | security/*.js | False sense of security — features listed but non-functional |

### 🟡 MEDIUM

| # | Vulnerability | Location |
|---|-------------|----------|
| M1 | Warning count display hardcoded "X/5" but threshold is configurable | antispam.js |
| M2 | AntiRaid lockdown destroys original channel permission overwrites | antiraid.js |
| M3 | 30s grace period after punishment allows continued spam | antispam.js |
| M4 | Caps detection only counts ASCII uppercase (Cyrillic bypass) | antispam.js |
| M5 | No rate limit on most button interactions | interactionCreate.js |
| M6 | Unknown config keys pass through ConfigService without sanitization | ConfigService.js |
| M7 | TOCTOU race on warning count increment | antispam.js |
| M8 | API keys appear in Safe Browsing/URLVoid URL strings | antilinks.js, LinkAnalyzer.js |

---

## 3. PERMISSION/TIER/CONFIG BYPASS PATHS

| Path | Bypass | Fix Required |
|------|--------|-------------|
| Button custom IDs | `verify_user_USERID` — no perm check, any clicker verifies target | Validate `interaction.user.id === targetId` |
| Context menu commands | Skip `checkCommandPermissions` entirely | Add perm check before context menu execute |
| Config `||` pattern | `config.threshold || 5` treats `0` as falsy → uses `5` | Change all `||` to `??` for numeric configs |
| ConfigService unknown keys | Keys not in schema accepted into DB | Reject unknown keys in `validateConfig()` |
| Moderator bypass in AutoMod | Any user with `ManageMessages` bypasses ALL automod | Too permissive — should be `ManageGuild` or role-based |
| AntiNuke whitelist | `track()` doesn't check whitelist before flagging | Check whitelist at `track()` entry |

---

## 4. MISSING RATE LIMITS, VALIDATION, ReDoS, RACE CONDITIONS

### Missing Rate Limits
- Button interactions (except `risk_action_*`) — no cooldown
- Ticket creation via slash command — no duplicate check
- Modal submissions — no rate limit (verification code brute-force)
- Autocomplete handlers — no rate limit
- BehaviorAnalysis OpenAI calls — no throttle (cost DoS)

### Missing Validation
- `spam_action` config accepts any string; unknown values do nothing
- Numeric thresholds have no min/max range validation
- AntiRaid `raid_threshold` of 1 triggers on every single join
- Autorole delay has no upper bound (memory leak with huge setTimeout)
- BehaviorAnalysis AI response parsed without score range validation

### ReDoS Risks
- **AutoMod word filter** — user-supplied regex patterns compiled and executed with no timeout or complexity limit. This is the only ReDoS vector but it's CRITICAL.

### Race Conditions
- Warning count TOCTOU in AntiSpam (concurrent messages read same count)
- Verification attempt count TOCTOU (concurrent button clicks bypass max)
- ConfigService `toggle()` double-toggle race
- Ticket creation race (two rapid modal submissions both pass open-ticket check)
- AntiNuke double `_bindEvents()` creates concurrent handler execution

---

## 5. SECURITY RULES CHARTER

These rules must **always** be true. Any code change that violates them is rejected.

### Rule 1: FAIL-CLOSED DEFAULTS
> Every feature flag, permission check, and security gate defaults to **OFF/DENIED**. Use `??` (nullish coalescing), never `||` (logical OR) for config defaults.

### Rule 2: SERVER-SIDE ENFORCEMENT ONLY
> No security decision may depend on client-side state, button custom ID content as sole authority, or UI-only validation. The `interaction.user` from Discord API is the only trusted identity.

### Rule 3: BOUNDED IN-MEMORY STATE
> Every Map, Set, or Array used for tracking must have: (a) a maximum size cap, (b) a TTL-based cleanup interval, (c) an eviction strategy when the cap is hit.

### Rule 4: BUTTON CUSTOM IDs ARE UNTRUSTED
> Custom IDs may contain hints (user IDs, ticket IDs) for convenience, but the handler must independently verify: (a) the clicker has permission, (b) the target exists and is valid, (c) the action is still applicable.

### Rule 5: ALL MUTATIONS ARE AUDITED
> Every enforcement action (delete, timeout, kick, ban, lockdown, role change, config change) must be logged to the database with: actor, target, action, reason, timestamp, reversibility flag.

### Rule 6: CONFIG CHANGES FLOW THROUGH ConfigService
> All config reads use `configService.resolveEffective()`. All config writes use `configService.update()`. Direct `database.getGuildConfig()` calls in security modules are prohibited for writes and deprecated for reads.

### Rule 7: CLEANUP RUNS AUTOMATICALLY
> Every module with in-memory state must register a cleanup interval in its constructor. The interval must be cleared on destroy/shutdown.

### Rule 8: BOT SELF-PERMISSION CHECKS BEFORE ENFORCEMENT
> Before any enforcement action (delete, timeout, kick, ban, role add/remove, channel edit), verify the bot has the required permission and role hierarchy. Fail gracefully with an audit log entry.

### Rule 9: MESSAGE EDITS ARE SECURITY-RELEVANT
> `messageUpdate` must trigger the same security pipeline as `messageCreate` for content that changed.

### Rule 10: NO UNSANDBOXED USER REGEX
> User-supplied regex patterns must be executed with a timeout wrapper and complexity limit. Patterns that exceed the limit are rejected.

---

*Phase 1 complete. Proceeding to Phase 2 — Implementation.*
