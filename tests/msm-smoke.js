/**
 * Standalone validation for Multi-Server Moderation.
 * Uses a real in-memory sqlite3 DB + a mocked bot. Run: node tests/msm-smoke.js
 */
const sqlite3 = require('sqlite3');
const MultiServerModeration = require('../src/security/multiServerModeration');

function makeDb() {
    const raw = new sqlite3.Database(':memory:');
    return {
        run: (sql, p = []) => new Promise((res, rej) => raw.run(sql, p, function (e) { e ? rej(e) : res({ id: this.lastID, changes: this.changes }); })),
        get: (sql, p = []) => new Promise((res, rej) => raw.get(sql, p, (e, r) => e ? rej(e) : res(r))),
        all: (sql, p = []) => new Promise((res, rej) => raw.all(sql, p, (e, r) => e ? rej(e) : res(r || []))),
    };
}

// Minimal DDL mirror of the msm_* tables from database.js createTables().
const DDL = [
`CREATE TABLE msm_networks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, main_guild_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, disabled INTEGER DEFAULT 0, disabled_reason TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(main_guild_id))`,
`CREATE TABLE msm_network_members (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER NOT NULL, guild_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', sync_bans INTEGER DEFAULT 1, sync_kicks INTEGER DEFAULT 0, sync_timeouts INTEGER DEFAULT 0, sync_warns INTEGER DEFAULT 0, enforcement_mode TEXT NOT NULL DEFAULT 'manual', added_by TEXT, joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(guild_id))`,
`CREATE TABLE msm_link_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER NOT NULL, source_guild_id TEXT NOT NULL, target_guild_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', token TEXT NOT NULL, requested_by TEXT, responded_by TEXT, dm_channel_id TEXT, message_id TEXT, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, responded_at DATETIME, UNIQUE(token))`,
`CREATE TABLE msm_synced_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER NOT NULL, origin_guild_id TEXT NOT NULL, target_guild_id TEXT NOT NULL, action_type TEXT NOT NULL, target_user_id TEXT NOT NULL, target_user_tag TEXT, moderator_id TEXT, reason TEXT, status TEXT NOT NULL DEFAULT 'pending', failure_reason TEXT, review_required INTEGER DEFAULT 0, reviewed_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, processed_at DATETIME)`,
`CREATE TABLE msm_exempt_users (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER NOT NULL, guild_id TEXT NOT NULL DEFAULT '*', user_id TEXT NOT NULL, reason TEXT, added_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(network_id, guild_id, user_id))`,
`CREATE TABLE msm_exempt_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER NOT NULL, guild_id TEXT NOT NULL, role_id TEXT NOT NULL, reason TEXT, added_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(network_id, guild_id, role_id))`,
`CREATE TABLE msm_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, network_id INTEGER, guild_id TEXT, event_type TEXT NOT NULL, actor_id TEXT, actor_tag TEXT, target_guild_id TEXT, target_user_id TEXT, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE mod_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, action_type TEXT, target_user_id TEXT, moderator_id TEXT, reason TEXT)`,
];

const G_MAIN = '100000000000000001';
const G_CHILD = '100000000000000002';
const U_TARGET = '200000000000000001';
const U_OWNER = '200000000000000009';

let failures = 0;
function assert(cond, label) {
    if (cond) { console.log('  ✓', label); } else { console.log('  ✗', label); failures++; }
}

async function main() {
    const db = makeDb();
    for (const sql of DDL) await db.run(sql);

    // Mock bot: two guilds present; child guild has a "me" member outranking target.
    const childGuild = {
        id: G_CHILD, name: 'Child Server', ownerId: U_OWNER, memberCount: 10,
        iconURL: () => null,
        members: {
            me: { permissions: { has: () => true }, roles: { highest: { position: 100 } } },
            fetch: async (id) => {
                if (id === U_TARGET) return { roles: { highest: { position: 5 }, cache: { has: () => false } }, manageable: true, kick: async () => {}, timeout: async () => {} };
                throw new Error('not found');
            },
            ban: async () => {},
        },
    };
    childGuild.members.ban = async () => {};
    const mainGuild = { id: G_MAIN, name: 'Main Server', ownerId: U_OWNER, iconURL: () => null, members: {} };
    const cache = new Map([[G_MAIN, mainGuild], [G_CHILD, childGuild]]);
    const bot = { database: db, logger: { info(){}, warn(){}, error(){}, debug(){} }, client: { guilds: { cache } } };

    const msm = new MultiServerModeration(bot);

    console.log('Network creation:');
    const net = await msm.createNetwork(G_MAIN, U_OWNER, 'Test Net', { id: U_OWNER, tag: 'owner#0' });
    assert(net && net.id, 'network created with id');
    const dupe = await msm.createNetwork(G_MAIN, U_OWNER, 'x', {}).then(() => false).catch(() => true);
    assert(dupe, 'duplicate network rejected');

    console.log('Membership (simulate approved link):');
    await db.run(`INSERT INTO msm_network_members (network_id, guild_id, role) VALUES (?, ?, 'member')`, [net.id, G_CHILD]);
    const members = await msm.getNetworkMembers(net.id);
    assert(members.length === 2 && members[0].role === 'main', 'main ordered first');

    console.log('Sync settings + enforcement:');
    await msm.updateSyncSettings(net.id, G_CHILD, { sync_bans: true, enforcement_mode: 'manual' }, { id: U_OWNER });
    let child = await db.get(`SELECT * FROM msm_network_members WHERE guild_id = ?`, [G_CHILD]);
    assert(child.sync_bans === 1 && child.enforcement_mode === 'manual', 'child syncs bans, manual mode');

    console.log('Propagation → manual review queue:');
    await msm.propagateAction({ originGuildId: G_MAIN, actionType: 'ban', targetUserId: U_TARGET, moderatorId: 'mod1', reason: 'spam' });
    let queue = await msm.getReviewQueue(net.id);
    assert(queue.length === 1 && queue[0].status === 'awaiting_review', 'ban queued for review (manual default)');

    console.log('Loop guard (network-reason ignored):');
    await msm.propagateAction({ originGuildId: G_MAIN, actionType: 'ban', targetUserId: U_TARGET, reason: '[Network: X] echo' });
    queue = await msm.getReviewQueue(net.id);
    assert(queue.length === 1, 'network-originated action not re-propagated');

    console.log('Exemptions:');
    await msm.addExemptUser(net.id, '*', U_TARGET, 'VIP', { id: U_OWNER });
    assert(await msm.isExempt(net.id, G_CHILD, U_TARGET), 'network-wide exempt user detected');
    assert(!(await msm.isExempt(net.id, G_CHILD, '200000000000000077')), 'non-exempt user not flagged');

    console.log('Safety: auto mode + owner protection:');
    await msm.updateSyncSettings(net.id, G_CHILD, { enforcement_mode: 'auto' }, { id: U_OWNER });
    const ownerOutcome = await msm.executeCrossServerAction({ network: net, targetGuildId: G_CHILD, actionType: 'ban', targetUserId: U_OWNER });
    assert(ownerOutcome.status === 'skipped' && /owner/i.test(ownerOutcome.reason), 'guild owner never actioned');

    console.log('Safety: exempt user skipped in auto execute:');
    const exemptOutcome = await msm.executeCrossServerAction({ network: net, targetGuildId: G_CHILD, actionType: 'ban', targetUserId: U_TARGET });
    assert(exemptOutcome.status === 'skipped' && /exempt/i.test(exemptOutcome.reason), 'exempt user skipped');

    console.log('Safety: applies to a normal target in auto mode:');
    await msm.removeExemptUser(net.id, '*', U_TARGET, { id: U_OWNER });
    const applied = await msm.executeCrossServerAction({ network: net, targetGuildId: G_CHILD, actionType: 'ban', targetUserId: U_TARGET, reason: 'bad actor' });
    assert(applied.status === 'applied', 'normal ban applies in auto mode');

    console.log('Review deny:');
    await msm.denyReviewAction(net.id, queue[0].id, { id: U_OWNER });
    const q2 = await msm.getReviewQueue(net.id);
    assert(q2.length === 0, 'denied action removed from queue');

    console.log('Panic switch halts propagation:');
    await msm.setPanic(net.id, true, 'test', { id: U_OWNER });
    await msm.updateSyncSettings(net.id, G_CHILD, { enforcement_mode: 'auto', sync_bans: true }, { id: U_OWNER });
    await msm.propagateAction({ originGuildId: G_MAIN, actionType: 'ban', targetUserId: '200000000000000055' });
    const rows = await db.all(`SELECT * FROM msm_synced_actions WHERE target_user_id = '200000000000000055'`);
    assert(rows.length === 0, 'no propagation while paused');

    console.log('Status read model:');
    await msm.setPanic(net.id, false, null, { id: U_OWNER });
    const status = await msm.getStatusForGuild(G_MAIN);
    assert(status.hasNetwork && status.isMain && status.hierarchy.main.id === G_MAIN, 'status: main + hierarchy root');
    assert(status.hierarchy.children.length === 1, 'status: one child in hierarchy');

    console.log('\n' + (failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`));
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
