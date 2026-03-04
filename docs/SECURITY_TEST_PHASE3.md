# Phase 3 — Security Test & Abuse Simulation Plan

> Generated after Phase 2 hardening. Every scenario below maps to a vulnerability ID from  
> [SECURITY_AUDIT_PHASE1.md](./SECURITY_AUDIT_PHASE1.md).

---

## 1. Test Matrix Overview

| # | Scenario | Vuln ID | Module(s) Under Test | Pass Criteria |
|---|----------|---------|---------------------|---------------|
| T1 | Message-edit bypass | C1 | messageUpdate.js, antispam, automod | Edited message triggers same pipeline as new message |
| T2 | Button-spoof verification | C2 | interactionCreate.js | Non-target user clicking `verify_user_<otherId>` is rejected |
| T3 | Verification brute-force | C3 | VerificationService.js | After 15 total failed/expired sessions, user is locked out |
| T4 | ReDoS via automod regex | C4 | automod.js, SafeRegex.js | Malicious regex pattern rejected; execution times <50ms |
| T5 | Cross-channel message flood | C5 | antispam.js | 4 msgs × 5 channels in 10s triggers `CROSS_CHANNEL_FLOOD` |
| T6 | AntiNuke double-bind | C6 | AntiNukeManager.js | Only 1 set of event listeners registered per instance |
| T7 | AntiNuke mitigate owner/self | C7 | AntiNukeManager.js | `mitigate()` skips owner, bot self, whitelisted users |
| T8 | Webhook destruction lockdown | C8 | AntiNukeManager.js | Lockdown no longer deletes all webhooks |
| T9 | ModMail unauthorized access | C9 | interactionCreate.js | Non-staff user clicking `modmail_close`/`modmail_claim` is rejected |
| T10 | Interaction rate limiting | C10 | InteractionGuard.js | >5 verify clicks/min → rate limited |
| T11 | Plaintext code leak | C3+ | VerificationService.js | When DMs fail, code is NOT posted in channel |
| T12 | CustomId guildId injection | C3+ | VerificationService.js | Non-snowflake guildId in modal customId is rejected |
| T13 | `||` vs `??` config defaults | H1 | antispam.js | Config value of `0` is respected, not replaced by default |
| T14 | BoundedMap memory cap | H2 | BoundedMap.js | Map never exceeds maxSize; oldest entries evicted |
| T15 | Auto-cleanup interval | H3 | antispam.js | Cleanup runs every 60s automatically |
| T16 | Whitelist check in track() | H4 | AntiNukeManager.js | Whitelisted user's destructive actions don't trigger nuke |
| T17 | Maintenance check caching | M1 | interactionCreate.js | Only 1 SQLite open per 10s, not per interaction |

---

## 2. Scripted Test Scenarios

### T1 — Message-Edit Bypass (C1)

**Setup:** Bot running, AntiSpam enabled, AutoMod word filter with blocked word "badword".

**Steps:**
1. User sends: `"Hello everyone!"`  
2. Verify message is NOT flagged.  
3. User edits message to: `"Hello badword everyone!"`  
4. Verify `messageUpdate.js` fires → AutoMod detects `"badword"` → message is deleted.
5. User edits a message older than 5 minutes → verify it is SKIPPED (stale edit protection).
6. Bot edits its own message → verify it is SKIPPED (bot filter).

**Expected Logs:**
```
[MessageUpdate] Processing edit by User#1234 in #general
[AutoMod] wordFilter violation by User#1234: Blocked word detected
```

**Fail condition:** Edited message containing blocked word remains visible.

---

### T2 — Button-Spoof Verification (C2)

**Setup:** Verification enabled, user A has pending verification with button `verify_user_<userA_id>`.

**Steps:**
1. User B clicks `verify_user_<userA_id>`.
2. Verify response: `"❌ This verification is not for you."`
3. Verify security log contains: `SECURITY: verify_user_ spoofing attempt by <userB_id>`
4. User A clicks `verify_user_<userA_id>` → verification proceeds normally.

**Fail condition:** User B successfully verifies User A.

---

### T3 — Verification Brute-Force (C3)

**Setup:** Verification method = `captcha`, maxGlobalAttempts = 15.

**Steps:**
1. User joins, gets verification code via DM.
2. User submits wrong code 5 times → session marked `failed`.
3. User clicks "Verify" again → new code issued, session count = 1 failed.
4. Repeat steps 2-3 two more times → 3 failed sessions × 5 attempts = 15 total.
5. User clicks "Verify" again → response: `"🔒 Verification Locked"`.
6. User submits modal with code → response: `"🔒 Verification Locked"`.
7. Staff clicks `verify_allow_<userId>` → user is verified (staff bypass).

**Expected DB state after lockout:**
```sql
SELECT COUNT(*) FROM verification_sessions 
WHERE guild_id = ? AND user_id = ? AND status IN ('failed','expired');
-- Result: >= 15
```

**Fail condition:** User gets a new code after 15+ total failed attempts.

---

### T4 — ReDoS via AutoMod Regex (C4)

**Setup:** AutoMod word filter enabled with regex patterns configured via dashboard.

**Steps:**
1. Admin sets regex pattern: `(a+)+$` (catastrophic backtracking).
2. Verify SafeRegex.validatePattern rejects it: `"Nested quantifier detected"`.
3. Admin sets regex pattern: `badword|evil` (safe pattern).
4. Verify it compiles and matches `"this is evil"`.
5. Admin sets regex pattern longer than 200 characters.
6. Verify rejection: `"Pattern too long"`.
7. User sends message matching safe pattern → message deleted.

**Performance test:**
```javascript
const SafeRegex = require('./src/utils/SafeRegex');
const start = Date.now();
const regex = SafeRegex.safeCompile('(a|b)+c', 'i');
SafeRegex.safeTest(regex, 'a'.repeat(100000));
console.assert(Date.now() - start < 100, 'Regex execution exceeded 100ms');
```

**Fail condition:** `(a+)+$` pattern is compiled and causes event loop hang.

---

### T5 — Cross-Channel Message Flood (C5)

**Setup:** AntiSpam enabled, flood threshold = 5 messages / 10 seconds.

**Steps:**
1. User sends 4 messages to #channel-1 within 10s → NOT flagged (under per-channel limit).
2. User sends 4 messages to #channel-2 within same 10s → NOT flagged per-channel.
3. User sends 3 messages to #channel-3 within same 10s → total = 11 messages, exceeds 5×2 = 10 global limit.
4. Verify `CROSS_CHANNEL_FLOOD` spam type triggered.
5. Verify user receives timeout/warning per configured `spam_action`.

**Fail condition:** User sends 20+ messages across channels without detection.

---

### T6 — AntiNuke Double Event Binding (C6)

**Setup:** Create AntiNukeManager instance.

**Steps:**
1. Count event listeners on client for `channelDelete` before creating AntiNukeManager.
2. Create new AntiNukeManager instance.
3. Count event listeners on client for `channelDelete` after.
4. Verify count increased by exactly 1 (not 2).

**Test code:**
```javascript
const before = client.listenerCount('channelDelete');
const anm = new AntiNukeManager(bot);
const after = client.listenerCount('channelDelete');
console.assert(after - before === 1, `Expected +1 listener, got +${after - before}`);
```

**Fail condition:** Listener count increases by 2 or more.

---

### T7 — AntiNuke Mitigate Safety Guards (C7)

**Setup:** AntiNukeManager with whitelist = `['trustedUserId']`.

**Steps:**
1. Call `mitigate(guild, guild.ownerId)` → verify NO action taken, log says `server_owner`.
2. Call `mitigate(guild, bot.client.user.id)` → verify NO action taken, log says `self`.
3. Call `mitigate(guild, 'trustedUserId')` → verify NO action taken, log says `whitelisted`.
4. Call `mitigate(guild, 'attackerUserId')` where attacker role < bot role → verify ban attempted.
5. Call `mitigate(guild, 'highRoleUserId')` where user role ≥ bot role → verify skipped with `hierarchy_too_high`.

**Fail condition:** Bot bans the server owner or itself.

---

### T8 — Lockdown Webhook Safety (C8)

**Steps:**
1. Create test webhooks in guild (simulating GitHub integration, CI/CD, etc.).
2. Trigger lockdown via `_triggerLockdown(guild)`.
3. Verify all webhooks still exist after lockdown.
4. Verify mod log contains `lockdown_activated` event.

**Fail condition:** Any webhook is deleted during lockdown.

---

### T9 — ModMail Staff Permission Check (C9)

**Steps:**
1. Non-staff user clicks `modmail_close_123` → verify rejection with staff-only message.
2. Non-staff user clicks `modmail_claim_123` → verify rejection.
3. Staff user (ManageGuild) clicks `modmail_close_123` → verify close proceeds.
4. User clicks `modmail_close_abc` (non-numeric ticketId) → verify rejection with `"Invalid ticket."`.

**Fail condition:** Non-staff user can close or claim modmail tickets.

---

### T10 — Interaction Rate Limiting (C10)

**Steps:**
1. User clicks verify button 5 times within 60 seconds → all 5 succeed.
2. User clicks verify button a 6th time within same 60s window → rate limited.
3. Wait 60 seconds → user can click again.
4. User clicks appeal button 2 times within 5 minutes → both succeed.
5. User clicks appeal button a 3rd time → rate limited.

**Test code:**
```javascript
const InteractionGuard = require('./src/utils/InteractionGuard');
const mockInteraction = { user: { id: 'test123' } };
for (let i = 0; i < 5; i++) {
    console.assert(!InteractionGuard.checkRateLimit(mockInteraction, 'verify'), `Click ${i+1} should pass`);
}
console.assert(InteractionGuard.checkRateLimit(mockInteraction, 'verify'), 'Click 6 should be rate limited');
```

**Fail condition:** User can click buttons unlimited times with no throttle.

---

### T11 — Plaintext Code Leak (C3+)

**Steps:**
1. Set verification method to `captcha`.
2. User with DMs disabled clicks verify button.
3. Verify response does NOT contain the code.
4. Verify response says: `"Please enable DMs from server members"`.
5. Verify the session is marked `failed` (counts toward global limit).

**Fail condition:** Verification code appears in any non-DM message.

---

### T12 — CustomId GuildId Injection (C3+)

**Steps:**
1. Forge a modal submission with customId `verify_code_modal_MALICIOUS_INPUT`.
2. Verify response: `"Could not determine server."` (non-snowflake rejected).
3. Forge with customId `verify_code_modal_12345` (too short) → rejected.
4. Forge with customId `verify_code_modal_123456789012345678` (valid snowflake format) → accepted.

**Fail condition:** Non-numeric or invalid-length guildId passes validation.

---

### T13 — Nullish Coalescing Config Defaults (H1)

**Steps:**
1. Set `antispam_flood_messages = 0` in guild config.
2. Verify the resolved `maxMessages` = `0` (not the default `5`).
3. With `||` operator, `0 || 5` = `5` (wrong). With `??`, `0 ?? 5` = `0` (correct).

**Test code:**
```javascript
// Simulate old behavior
const badDefault = 0 || 5; // Returns 5 — WRONG
const goodDefault = 0 ?? 5; // Returns 0 — CORRECT
console.assert(goodDefault === 0, 'Nullish coalescing failed');
```

**Fail condition:** A configured value of `0` is ignored.

---

### T14 — BoundedMap Memory Cap (H2)

**Test code:**
```javascript
const BoundedMap = require('./src/utils/BoundedMap');
const map = new BoundedMap({ maxSize: 100, ttlMs: 1000 });

for (let i = 0; i < 200; i++) {
    map.set(`key_${i}`, i);
}

console.assert(map.size <= 100, `Map size ${map.size} exceeds maxSize 100`);
console.assert(!map.has('key_0'), 'Oldest entry should have been evicted');
console.assert(map.has('key_199'), 'Newest entry should exist');

// TTL test
map.set('ttl_test', 'value');
setTimeout(() => {
    console.assert(!map.has('ttl_test'), 'Entry should have expired after TTL');
    map.destroy();
}, 1100);
```

**Fail condition:** Map grows unbounded past maxSize.

---

### T15 — Auto-Cleanup Interval (H3)

**Steps:**
1. Create AntiSpam instance.
2. Verify `this._cleanupInterval` is set (not null/undefined).
3. Wait 65 seconds.
4. Add stale entries to `userChannelMessages` with timestamps 15 minutes ago.
5. Verify after next cleanup cycle, stale entries are removed.

**Fail condition:** Cleanup never runs; Maps grow indefinitely.

---

## 3. Performance & Stress Tests

### P1 — BoundedMap Under Load

```javascript
const BoundedMap = require('./src/utils/BoundedMap');
const map = new BoundedMap({ maxSize: 10000, ttlMs: 60000 });
const start = Date.now();

for (let i = 0; i < 100000; i++) {
    map.set(`key_${i}`, { data: 'x'.repeat(100) });
}

const elapsed = Date.now() - start;
console.log(`100K inserts: ${elapsed}ms, final size: ${map.size}`);
console.assert(map.size <= 10000, 'Exceeded maxSize');
console.assert(elapsed < 5000, 'Too slow');
map.destroy();
```

### P2 — SafeRegex Timeout

```javascript
const SafeRegex = require('./src/utils/SafeRegex');

// Test that catastrophic patterns are caught at compile time
const dangerous = ['(a+)+$', '(a|aa)+$', '(.*){1,10}', '([a-zA-Z]+)*\\d'];
for (const p of dangerous) {
    const result = SafeRegex.safeCompile(p, 'i');
    console.assert(result === null, `Dangerous pattern "${p}" should be rejected`);
}

// Test safe patterns work
const safe = ['badword', 'hello|world', '\\btest\\b', '[0-9]{3,5}'];
for (const p of safe) {
    const result = SafeRegex.safeCompile(p, 'i');
    console.assert(result !== null, `Safe pattern "${p}" should compile`);
}
```

### P3 — Interaction Rate Limiter Throughput

```javascript
const InteractionGuard = require('./src/utils/InteractionGuard');
const start = Date.now();

for (let i = 0; i < 10000; i++) {
    InteractionGuard.checkRateLimit(
        { user: { id: `user_${i % 100}` } },
        'general'
    );
}

const elapsed = Date.now() - start;
console.log(`10K rate limit checks: ${elapsed}ms`);
console.assert(elapsed < 1000, 'Rate limiting too slow');
```

---

## 4. Abuse Simulation Scenarios

### A1 — Coordinated Raid via Message Edits
**Attacker profile:** 10 alt accounts join, post innocent messages, then simultaneously edit all messages to phishing links.
**Expected outcome:** `messageUpdate.js` catches all 10 edits → AntiLinks/AutoMod deletes them → AntiSpam triggers flood detection.

### A2 — Verification Code Farming
**Attacker profile:** Bot script repeatedly clicks verify → gets code → lets it expire → repeats.
**Expected outcome:** After 3 cycles (15 total attempts), user is globally locked. Rate limiter blocks rapid clicks. Audit trail shows all attempts.

### A3 — ReDoS Service Denial
**Attacker profile:** Compromised admin sets regex `(a+)+$` in automod word filter via dashboard.
**Expected outcome:** SafeRegex.validatePattern rejects the pattern at compile time. Event loop never hangs.

### A4 — Cross-Channel Spam Flood
**Attacker profile:** User sends 4 messages each to 10 different channels within 10 seconds (40 total, under per-channel limit of 5).
**Expected outcome:** Cross-channel flood detector triggers at message #11 (5×2 global threshold). User timed out.

### A5 — Button Spoof Attack
**Attacker profile:** Attacker crafts a forged button click for `verify_user_<victimId>`.
**Expected outcome:** `interaction.user.id !== targetUserId` check blocks the attempt. Security warning logged.

### A6 — ModMail Ticket Hijack
**Attacker profile:** Regular user discovers `modmail_close_<ticketId>` customId pattern, crafts button click.
**Expected outcome:** Staff permission check (ManageGuild || Administrator || ModerateMembers) blocks non-staff. Response: "❌ Staff only."

### A7 — Memory Exhaustion via Spam Tracking
**Attacker profile:** 10,000 unique users each send 1 message (populating Maps).
**Expected outcome:** BoundedMap caps all Maps at maxSize (10K-20K entries). Oldest entries evicted. Cleanup interval prunes stale data every 60s.

### A8 — Nuke via Compromised Admin
**Attacker profile:** Compromised admin account mass-deletes channels.
**Expected outcome:** AntiNukeManager detects rapid deletes → checks whitelist (compromised admin is NOT whitelisted) → checks hierarchy → bans if possible → logs event. Does NOT delete webhooks. Does NOT act against owner/self.

---

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Edit bypass detection rate | 100% | T1 pass |
| Button spoof block rate | 100% | T2 pass |
| Brute-force lockout | After 15 attempts | T3 pass |
| ReDoS patterns rejected | 100% of known patterns | T4 pass |
| Cross-channel flood detection | Within 2× per-channel limit | T5 pass |
| Memory growth under 10K users | < 50MB additional | P1 + T14 |
| Rate limit check latency | < 0.1ms per check | P3 |
| Regex execution timeout | < 50ms | P2 |
| False positive rate | < 1% on normal traffic | Manual validation |
| Zero self-harm | Bot never bans owner/self | T7 pass |

---

## 6. Regression Checklist

After applying all Phase 2 changes, verify these existing features still work:

- [ ] `/ban`, `/kick`, `/timeout` commands execute normally
- [ ] Verification flow completes for legitimate users (button, captcha, web methods)
- [ ] AutoMod word filter catches blocked words
- [ ] AntiSpam detects genuine flood spam and applies configured action
- [ ] Ticket creation, claiming, and closing work for staff
- [ ] ModMail open/close cycle works for staff
- [ ] Dashboard settings changes propagate to bot via ConfigService
- [ ] Welcome messages sent after verification
- [ ] Reaction roles still function
- [ ] Help command and help ticket flow work
- [ ] Appeal system accepts and processes appeals
- [ ] Bot can be restarted cleanly (no leaked intervals, no uncaught exceptions)

---

## 7. Files Modified in Phase 2 (Audit Trail)

| File | Action | Vulnerability Fixed |
|------|--------|-------------------|
| `src/utils/BoundedMap.js` | **Created** | H2 — Unbounded Maps |
| `src/utils/SafeRegex.js` | **Created** | C4 — ReDoS |
| `src/utils/InteractionGuard.js` | **Created** | C10 — No rate limiting |
| `src/events/messageUpdate.js` | **Created** | C1 — Edit bypass |
| `src/bot.js` | Modified | C1 — Register messageUpdate |
| `src/core/events/interactionCreate.js` | Modified | C2, C9, C10, M1 — Spoof, perms, rate limit, maintenance cache |
| `src/services/VerificationService.js` | Modified | C3 — Brute-force, plaintext leak, guildId injection |
| `src/security/automod.js` | Modified | C4 — SafeRegex integration |
| `src/security/AntiNukeManager.js` | Modified | C6, C7, C8, H4 — Double-bind, owner/self, webhooks, whitelist |
| `src/security/antispam.js` | Modified | C5, H1, H2, H3 — Cross-channel, defaults, bounded maps, auto-cleanup |

---

*Document generated as part of the security hardening initiative.*  
*All test scenarios should be executed before deploying to production.*
