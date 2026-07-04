/**
 * Darklock Admin v4 — Database Query Layer
 * All DB access goes through here. Frontend never touches SQL.
 */

'use strict';

const db = require('../../utils/database');

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW / STATS
// ═══════════════════════════════════════════════════════════════════════════════
async function getOverviewStats() {
  const [
    totalUsers,
    premiumUsers,
    activeUsers,
    totalBugReports,
    openBugReports,
    latestAnnouncement,
    appVersion,
  ] = await Promise.all([
    db.get(`SELECT COUNT(*) as count FROM users`),
    db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'premium' OR role = 'vip'`),
    db.get(`SELECT COUNT(*) as count FROM users WHERE last_login >= datetime('now', '-7 days')`),
    db.get(`SELECT COUNT(*) as count FROM bug_reports_v2`),
    db.get(`SELECT COUNT(*) as count FROM bug_reports_v2 WHERE status = 'open'`),
    db.get(`SELECT * FROM platform_announcements ORDER BY created_at DESC LIMIT 1`),
    db.get(`SELECT value FROM platform_config WHERE key = 'current_app_version'`),
  ]);

  return {
    totalUsers:        totalUsers?.count || 0,
    premiumUsers:      premiumUsers?.count || 0,
    activeUsers:       activeUsers?.count || 0,
    totalBugReports:   totalBugReports?.count || 0,
    openBugReports:    openBugReports?.count || 0,
    latestAnnouncement: latestAnnouncement || null,
    currentAppVersion: appVersion?.value || '0.0.0',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════
async function getAnnouncements({ limit = 50, offset = 0 } = {}) {
  return db.all(`
    SELECT * FROM platform_announcements
    ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

async function getAnnouncementById(id) {
  return db.get(`SELECT * FROM platform_announcements WHERE id = ?`, [id]);
}

async function createAnnouncement({ id, title, content, version, category, status, visibility, pinned, author_id, author_email, published_at }) {
  await db.run(`
    INSERT INTO platform_announcements (id, title, content, version, category, status, visibility, pinned, author_id, author_email, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    title,
    content,
    version || null,
    category || 'update',
    status || 'published',
    visibility || 'public',
    pinned ? 1 : 0,
    author_id,
    author_email,
    published_at || new Date().toISOString(),
  ]);
  return getAnnouncementById(id);
}

async function updateAnnouncement(id, { title, content, version, category, status, visibility, pinned, published_at }) {
  await db.run(`
    UPDATE platform_announcements
    SET title = COALESCE(?, title),
        content = COALESCE(?, content),
        version = COALESCE(?, version),
        category = COALESCE(?, category),
        status = COALESCE(?, status),
        visibility = COALESCE(?, visibility),
        published_at = COALESCE(?, published_at),
        pinned = COALESCE(?, pinned),
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    title,
    content,
    version,
    category,
    status,
    visibility,
    published_at,
    pinned !== undefined ? (pinned ? 1 : 0) : undefined,
    id,
  ]);
  return getAnnouncementById(id);
}

async function deleteAnnouncement(id) {
  return db.run(`DELETE FROM platform_announcements WHERE id = ?`, [id]);
}

async function getNextAnnouncementVersion() {
  const latest = await db.get(`
    SELECT version FROM platform_announcements
    WHERE version IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `);
  if (!latest?.version) return '1.0.0';
  const parts = latest.version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNTS (users table)
// ═══════════════════════════════════════════════════════════════════════════════
const EFFECTIVE_PLAN_SQL = `COALESCE(NULLIF(up.plan, ''), CASE WHEN u.role IN ('premium','vip') THEN 'pro' ELSE 'free' END)`;

async function getAccounts({ search, filter, limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (search) {
    where.push(`(u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)`);
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  if (filter === 'premium' || filter === 'paid') { where.push(`${EFFECTIVE_PLAN_SQL} IN ('pro','enterprise')`); }
  if (filter === 'pro')       { where.push(`${EFFECTIVE_PLAN_SQL} = 'pro'`); }
  if (filter === 'enterprise'){ where.push(`${EFFECTIVE_PLAN_SQL} = 'enterprise'`); }
  if (filter === 'free')      { where.push(`${EFFECTIVE_PLAN_SQL} = 'free'`); }
  if (filter === 'admin')     { where.push(`u.role IN ('admin','owner')`); }
  if (filter === 'banned')    { where.push(`u.active = 0`); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const fromClause = `FROM users u LEFT JOIN admin_user_plans up ON up.user_id = u.id`;

  const [rows, countRow] = await Promise.all([
    db.all(`
      SELECT
        u.id, u.username, u.email, u.display_name, u.role, u.avatar, u.active, u.created_at, u.last_login,
        u.oauth_provider, u.oauth_id,
        ${EFFECTIVE_PLAN_SQL} AS plan,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > datetime('now')) AS active_sessions,
        (SELECT MAX(s.last_active) FROM sessions s WHERE s.user_id = u.id) AS last_active
      ${fromClause} ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]),
    db.get(`SELECT COUNT(*) as total ${fromClause} ${whereClause}`, params),
  ]);

  return { accounts: rows || [], total: countRow?.total || 0 };
}

async function getAccountById(userId) {
  return db.get(`
    SELECT
      u.id, u.username, u.email, u.display_name, u.role, u.avatar, u.active, u.created_at, u.last_login, u.settings,
      u.oauth_provider, u.oauth_id,
      ${EFFECTIVE_PLAN_SQL} AS plan,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > datetime('now')) AS active_sessions,
      (SELECT MAX(s.last_active) FROM sessions s WHERE s.user_id = u.id) AS last_active
    FROM users u
    LEFT JOIN admin_user_plans up ON up.user_id = u.id
    WHERE u.id = ?
  `, [userId]);
}

async function updateAccountRole(userId, role) {
  return db.run(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`, [role, userId]);
}

async function setAccountPlan(userId, plan, assignedBy) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  if (!['free', 'pro', 'enterprise'].includes(normalizedPlan)) {
    throw new Error('Invalid plan. Use free, pro, or enterprise.');
  }

  const existing = await db.get(`SELECT id, role FROM users WHERE id = ?`, [userId]);
  if (!existing) throw new Error('Account not found');

  await db.run(`
    INSERT INTO admin_user_plans (user_id, plan, assigned_by, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      plan = excluded.plan,
      assigned_by = excluded.assigned_by,
      updated_at = datetime('now')
  `, [userId, normalizedPlan, assignedBy || null]);

  const role = String(existing.role || '').toLowerCase();
  if (!['owner', 'coowner', 'admin', 'mod', 'pr', 'helper', 'bug_tester'].includes(role)) {
    const mappedRole = normalizedPlan === 'free' ? 'user' : 'premium';
    await db.run(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`, [mappedRole, userId]);
  }

  return getAccountById(userId);
}

async function banAccount(userId) {
  return db.run(`UPDATE users SET active = 0, updated_at = datetime('now') WHERE id = ?`, [userId]);
}

async function unbanAccount(userId) {
  return db.run(`UPDATE users SET active = 1, updated_at = datetime('now') WHERE id = ?`, [userId]);
}

async function deleteAccount(userId) {
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
  return db.run(`DELETE FROM users WHERE id = ?`, [userId]);
}

async function resetAccountPassword(userId, hashedPassword) {
  return db.run(`UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`, [hashedPassword, userId]);
}

async function getAccountSessions(userId) {
  return db.all(`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`, [userId]);
}

async function getAccountDevices(userId) {
  // Check device-status.json or a devices table if available
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const dataDir = process.env.DATA_PATH || require('path').join(__dirname, '../../data');
    const data = JSON.parse(await fs.readFile(path.join(dataDir, 'device-status.json'), 'utf-8'));
    return (data.devices || []).filter(d => d.userId === userId);
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER ACCOUNTS (Guild/Server Management)
// ═══════════════════════════════════════════════════════════════════════════════
async function upsertServerAccount({
  server_id,
  server_name,
  owner_user_id,
  premium_active,
  premium_expires_at,
  premium_plan,
  blocked,
  blocked_reason,
  bot_joined,
  notes,
  updated_by,
}) {
  await db.run(`
    INSERT INTO admin_server_accounts (
      server_id, server_name, owner_user_id, premium_active, premium_expires_at,
      premium_plan, blocked, blocked_reason, bot_joined, notes, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(server_id) DO UPDATE SET
      server_name = COALESCE(excluded.server_name, admin_server_accounts.server_name),
      owner_user_id = COALESCE(excluded.owner_user_id, admin_server_accounts.owner_user_id),
      premium_active = COALESCE(excluded.premium_active, admin_server_accounts.premium_active),
      premium_expires_at = COALESCE(excluded.premium_expires_at, admin_server_accounts.premium_expires_at),
      premium_plan = COALESCE(excluded.premium_plan, admin_server_accounts.premium_plan),
      blocked = COALESCE(excluded.blocked, admin_server_accounts.blocked),
      blocked_reason = COALESCE(excluded.blocked_reason, admin_server_accounts.blocked_reason),
      bot_joined = COALESCE(excluded.bot_joined, admin_server_accounts.bot_joined),
      notes = COALESCE(excluded.notes, admin_server_accounts.notes),
      updated_at = datetime('now'),
      updated_by = excluded.updated_by
  `, [
    server_id,
    server_name || null,
    owner_user_id || null,
    premium_active === undefined ? null : (premium_active ? 1 : 0),
    premium_expires_at || null,
    premium_plan || null,
    blocked === undefined ? null : (blocked ? 1 : 0),
    blocked_reason || null,
    bot_joined === undefined ? null : (bot_joined ? 1 : 0),
    notes || null,
    updated_by || null,
  ]);

  return db.get(`SELECT * FROM admin_server_accounts WHERE server_id = ?`, [server_id]);
}

async function searchServerAccounts({ q, limit = 50, offset = 0 } = {}) {
  const query = String(q || '').trim();
  if (!query) {
    const rows = await db.all(`
      SELECT * FROM admin_server_accounts
      ORDER BY updated_at DESC, server_id ASC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    const total = await db.get(`SELECT COUNT(*) AS total FROM admin_server_accounts`);
    return { servers: rows || [], total: total?.total || 0 };
  }

  const like = `%${query}%`;
  const rows = await db.all(`
    SELECT * FROM admin_server_accounts
    WHERE server_id = ?
       OR server_name LIKE ?
       OR owner_user_id LIKE ?
    ORDER BY updated_at DESC, server_id ASC
    LIMIT ? OFFSET ?
  `, [query, like, like, limit, offset]);

  const total = await db.get(`
    SELECT COUNT(*) AS total
    FROM admin_server_accounts
    WHERE server_id = ?
       OR server_name LIKE ?
       OR owner_user_id LIKE ?
  `, [query, like, like]);

  return { servers: rows || [], total: total?.total || 0 };
}

async function getServerAccountById(serverId) {
  return db.get(`SELECT * FROM admin_server_accounts WHERE server_id = ?`, [serverId]);
}

async function setServerPremium({ server_id, premium_active, premium_expires_at, premium_plan, updated_by }) {
  return upsertServerAccount({
    server_id,
    premium_active,
    premium_expires_at,
    premium_plan,
    updated_by,
  });
}

async function setServerBlocked({ server_id, blocked, blocked_reason, updated_by }) {
  return upsertServerAccount({
    server_id,
    blocked,
    blocked_reason,
    updated_by,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROLES & ACCESS
// ═══════════════════════════════════════════════════════════════════════════════
async function getAdminUsers() {
  return db.all(`SELECT id, email, username, role, display_name, active, last_login, created_at FROM admins ORDER BY role ASC, email ASC`);
}

async function getAdminById(adminId) {
  return db.get(`SELECT id, email, username, role, display_name, active, last_login, created_at FROM admins WHERE id = ?`, [adminId]);
}

async function getRoles() {
  return db.all(`SELECT * FROM admin_roles ORDER BY level DESC`);
}

async function getRolePermissions(roleId) {
  return db.all(`SELECT * FROM admin_permissions WHERE role_id = ?`, [roleId]);
}

async function setRolePermission(roleId, permission, granted) {
  return db.run(`
    INSERT INTO admin_permissions (role_id, permission, granted) VALUES (?, ?, ?)
    ON CONFLICT(role_id, permission) DO UPDATE SET granted = excluded.granted
  `, [roleId, permission, granted ? 1 : 0]);
}

async function updateAdminRole(adminId, newRole) {
  return db.run(`UPDATE admins SET role = ?, updated_at = datetime('now') WHERE id = ?`, [newRole, adminId]);
}

async function deleteAdmin(adminId) {
  return db.run(`DELETE FROM admins WHERE id = ?`, [adminId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  POLLS (Admin tab + public /platform/polls)
// ═══════════════════════════════════════════════════════════════════════════════
async function getPolls({ status, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const polls = await db.all(`
    SELECT p.*,
           COUNT(DISTINCT pv.id) AS total_votes
    FROM polls p
    LEFT JOIN poll_votes pv ON p.id = pv.poll_id
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const count = await db.get(`SELECT COUNT(*) AS total FROM polls p ${whereClause}`, params);
  return { polls: polls || [], total: count?.total || 0 };
}

async function getPollById(id) {
  const poll = await db.get(`SELECT * FROM polls WHERE id = ?`, [id]);
  if (!poll) return null;
  const options = await db.all(`SELECT id, option_text, votes FROM poll_options WHERE poll_id = ? ORDER BY rowid ASC`, [id]);
  return { ...poll, options: options || [] };
}

async function createPoll({ id, title, description, type, status, options, created_by, updated_by, published_by }) {
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO polls (id, title, description, type, status, created_by, updated_by, published_by, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    title,
    description || null,
    type || 'feature',
    status || 'draft',
    created_by,
    updated_by || created_by,
    published_by || null,
    now,
    now,
    status === 'published' ? now : null,
  ]);

  for (const optionText of (options || [])) {
    const optionId = require('crypto').randomUUID();
    await db.run(`INSERT INTO poll_options (id, poll_id, option_text, votes) VALUES (?, ?, ?, 0)`, [optionId, id, String(optionText)]);
  }

  return getPollById(id);
}

async function updatePoll(id, { title, description, type, status, options, updated_by, published_by }) {
  const current = await db.get(`SELECT * FROM polls WHERE id = ?`, [id]);
  if (!current) return null;

  const nextStatus = status || current.status;
  await db.run(`
    UPDATE polls
    SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        type = COALESCE(?, type),
        status = COALESCE(?, status),
        updated_by = COALESCE(?, updated_by),
        published_by = CASE
          WHEN ? = 'published' AND published_by IS NULL THEN ?
          ELSE published_by
        END,
        published_at = CASE
          WHEN ? = 'published' AND published_at IS NULL THEN datetime('now')
          ELSE published_at
        END,
        archived_at = CASE WHEN ? = 'archived' THEN datetime('now') ELSE archived_at END,
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    title,
    description,
    type,
    status,
    updated_by || null,
    nextStatus,
    published_by || null,
    nextStatus,
    nextStatus,
    id,
  ]);

  if (Array.isArray(options) && options.length >= 2) {
    await db.run(`DELETE FROM poll_options WHERE poll_id = ?`, [id]);
    for (const optionText of options) {
      const optionId = require('crypto').randomUUID();
      await db.run(`INSERT INTO poll_options (id, poll_id, option_text, votes) VALUES (?, ?, ?, 0)`, [optionId, id, String(optionText)]);
    }
    await db.run(`DELETE FROM poll_votes WHERE poll_id = ?`, [id]);
  }

  return getPollById(id);
}

async function deletePoll(id) {
  await db.run(`DELETE FROM poll_votes WHERE poll_id = ?`, [id]);
  await db.run(`DELETE FROM poll_options WHERE poll_id = ?`, [id]);
  return db.run(`DELETE FROM polls WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════════════════════════════════════
async function getTasks({ status, assigned_role, assigned_user_id, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (assigned_role) { where.push('assigned_role = ?'); params.push(assigned_role); }
  if (assigned_user_id) { where.push('assigned_user_id = ?'); params.push(assigned_user_id); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const tasks = await db.all(`
    SELECT *
    FROM admin_tasks
    ${whereClause}
    ORDER BY
      CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
      updated_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const total = await db.get(`SELECT COUNT(*) AS total FROM admin_tasks ${whereClause}`, params);
  return { tasks: tasks || [], total: total?.total || 0 };
}

async function getTaskById(id) {
  const task = await db.get(`SELECT * FROM admin_tasks WHERE id = ?`, [id]);
  if (!task) return null;
  const comments = await db.all(`SELECT * FROM admin_task_comments WHERE task_id = ? ORDER BY created_at ASC`, [id]);
  return { ...task, comments: comments || [] };
}

async function createTask({
  id,
  title,
  description,
  priority,
  status,
  category,
  assigned_role,
  assigned_user_id,
  requested_by,
  created_by,
  due_date,
}) {
  await db.run(`
    INSERT INTO admin_tasks (
      id, title, description, priority, status, category, assigned_role, assigned_user_id,
      requested_by, created_by, due_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
    id,
    title,
    description,
    priority || 'normal',
    status || 'requested',
    category || null,
    assigned_role || null,
    assigned_user_id || null,
    requested_by || null,
    created_by,
    due_date || null,
  ]);
  return getTaskById(id);
}

async function updateTask(id, patch = {}) {
  const current = await db.get(`SELECT * FROM admin_tasks WHERE id = ?`, [id]);
  if (!current) return null;

  await db.run(`
    UPDATE admin_tasks
    SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      priority = COALESCE(?, priority),
      status = COALESCE(?, status),
      category = COALESCE(?, category),
      assigned_role = COALESCE(?, assigned_role),
      assigned_user_id = COALESCE(?, assigned_user_id),
      approved_by = COALESCE(?, approved_by),
      due_date = COALESCE(?, due_date),
      completed_at = CASE WHEN COALESCE(?, status) = 'complete' THEN datetime('now') ELSE completed_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `, [
    patch.title,
    patch.description,
    patch.priority,
    patch.status,
    patch.category,
    patch.assigned_role,
    patch.assigned_user_id,
    patch.approved_by,
    patch.due_date,
    patch.status,
    id,
  ]);

  return getTaskById(id);
}

async function addTaskComment({ id, task_id, admin_id, admin_email, comment, old_status, new_status }) {
  await db.run(`
    INSERT INTO admin_task_comments (id, task_id, admin_id, admin_email, comment, old_status, new_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [id, task_id, admin_id || null, admin_email || null, comment, old_status || null, new_status || null]);
  return db.get(`SELECT * FROM admin_task_comments WHERE id = ?`, [id]);
}

async function deleteTask(id) {
  await db.run(`DELETE FROM admin_task_comments WHERE task_id = ?`, [id]);
  return db.run(`DELETE FROM admin_tasks WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP UPDATES (multi-app: ridgeline + legacy secure-guard, secure-channel, secure-notes)
// ═══════════════════════════════════════════════════════════════════════════════
const VALID_APPS = ['ridgeline', 'secure-guard', 'secure-channel', 'secure-notes'];

async function getAppUpdates({ limit = 50, offset = 0, channel, app } = {}) {
  let where = [];
  let params = [];
  if (channel && channel !== 'all') { where.push('channel = ?'); params.push(channel); }
  if (app && VALID_APPS.includes(app)) { where.push('app = ?'); params.push(app); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db.all(`SELECT * FROM app_updates ${whereClause} ORDER BY published_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
}

async function getAppUpdateById(id) {
  return db.get(`SELECT * FROM app_updates WHERE id = ?`, [id]);
}

async function getLatestAppUpdate(channel = 'stable', app = 'secure-guard') {
  const validApp = VALID_APPS.includes(app) ? app : 'secure-guard';
  if (channel === 'beta') {
    // Return latest beta build, fall back to latest stable if no beta exists
    const beta = await db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'beta' ORDER BY published_at DESC LIMIT 1`, [validApp]);
    return beta || db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'stable' ORDER BY published_at DESC LIMIT 1`, [validApp]);
  }
  const stable = await db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'stable' ORDER BY published_at DESC LIMIT 1`, [validApp]);
  return stable || db.get(`SELECT * FROM app_updates WHERE app = ? ORDER BY published_at DESC LIMIT 1`, [validApp]);
}

async function getAllLatestUpdates(channel = 'stable') {
  const results = {};
  for (const app of VALID_APPS) {
    if (channel === 'beta') {
      const beta = await db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'beta' ORDER BY published_at DESC LIMIT 1`, [app]);
      results[app] = beta || await db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'stable' ORDER BY published_at DESC LIMIT 1`, [app]);
    } else {
      results[app] = await db.get(`SELECT * FROM app_updates WHERE app = ? AND channel = 'stable' ORDER BY published_at DESC LIMIT 1`, [app]);
    }
  }
  return results;
}

async function getAppUpdateHistory(app, limit = 20) {
  const validApp = VALID_APPS.includes(app) ? app : 'secure-guard';
  return db.all(`SELECT * FROM app_updates WHERE app = ? ORDER BY published_at DESC LIMIT ?`, [validApp, limit]);
}

async function createAppUpdate({ id, app, version, title, changelog, download_url, force_update, min_version, channel, platform, file_size, published_by }) {
  const ch = (channel === 'beta') ? 'beta' : 'stable';
  const validApp = VALID_APPS.includes(app) ? app : 'secure-guard';
  await db.run(`
    INSERT INTO app_updates (id, app, version, title, changelog, download_url, force_update, min_version, channel, platform, file_size, published_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, validApp, version, title, changelog, download_url || null, force_update ? 1 : 0, min_version || null, ch, platform || null, file_size || null, published_by]);
  return getAppUpdateById(id);
}

async function deleteAppUpdate(id) {
  return db.run(`DELETE FROM app_updates WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHOP CATALOG (Ridgeline)
// ═══════════════════════════════════════════════════════════════════════════════
function parseFeatures(featuresJson) {
  if (!featuresJson) return [];
  try {
    const parsed = JSON.parse(featuresJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeShopProduct(row) {
  if (!row) return null;
  return {
    ...row,
    features: parseFeatures(row.features_json),
    price_dollars: Number(row.price_cents || 0) / 100,
  };
}

async function getShopProducts({ app = 'ridgeline', includeUnpublished = false, limit = 100, offset = 0 } = {}) {
  const where = ['app = ?'];
  const params = [app];

  if (!includeUnpublished) {
    where.push('published = 1');
  }

  const rows = await db.all(`
    SELECT * FROM shop_products
    WHERE ${where.join(' AND ')}
    ORDER BY sort_order ASC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return (rows || []).map(normalizeShopProduct);
}

async function getShopProductById(id) {
  const row = await db.get(`SELECT * FROM shop_products WHERE id = ?`, [id]);
  return normalizeShopProduct(row);
}

async function createShopProduct({
  id,
  app = 'ridgeline',
  slug,
  title,
  subtitle,
  description,
  image_url,
  badge,
  price_cents,
  currency = 'usd',
  billing_type = 'one_time',
  stripe_price_id,
  features,
  sort_order = 0,
  published = false,
  published_by,
  created_by,
}) {
  const features_json = Array.isArray(features) ? JSON.stringify(features) : null;

  await db.run(`
    INSERT INTO shop_products (
      id, app, slug, title, subtitle, description, image_url, badge,
      price_cents, currency, billing_type, stripe_price_id, features_json,
      sort_order, published, published_by, published_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, ?, datetime('now'))
  `, [
    id,
    app,
    slug || null,
    title,
    subtitle || null,
    description || null,
    image_url || null,
    badge || null,
    price_cents,
    (currency || 'usd').toLowerCase(),
    billing_type,
    stripe_price_id || null,
    features_json,
    sort_order,
    published ? 1 : 0,
    published ? (published_by || created_by || null) : null,
    published ? 1 : 0,
    created_by || null,
  ]);

  return getShopProductById(id);
}

async function updateShopProduct(id, patch = {}) {
  const current = await db.get(`SELECT * FROM shop_products WHERE id = ?`, [id]);
  if (!current) return null;

  const nextFeatures = patch.features !== undefined
    ? (Array.isArray(patch.features) ? JSON.stringify(patch.features) : null)
    : current.features_json;

  await db.run(`
    UPDATE shop_products
    SET
      slug = COALESCE(?, slug),
      title = COALESCE(?, title),
      subtitle = COALESCE(?, subtitle),
      description = COALESCE(?, description),
      image_url = COALESCE(?, image_url),
      badge = COALESCE(?, badge),
      price_cents = COALESCE(?, price_cents),
      currency = COALESCE(?, currency),
      billing_type = COALESCE(?, billing_type),
      stripe_price_id = COALESCE(?, stripe_price_id),
      features_json = ?,
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now')
    WHERE id = ?
  `, [
    patch.slug,
    patch.title,
    patch.subtitle,
    patch.description,
    patch.image_url,
    patch.badge,
    patch.price_cents,
    patch.currency ? String(patch.currency).toLowerCase() : undefined,
    patch.billing_type,
    patch.stripe_price_id,
    nextFeatures,
    patch.sort_order,
    id,
  ]);

  return getShopProductById(id);
}

async function setShopProductPublished(id, published, adminEmail) {
  await db.run(`
    UPDATE shop_products
    SET
      published = ?,
      published_by = ?,
      published_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      updated_at = datetime('now')
    WHERE id = ?
  `, [published ? 1 : 0, published ? (adminEmail || null) : null, published ? 1 : 0, id]);

  return getShopProductById(id);
}

async function deleteShopProduct(id) {
  return db.run(`DELETE FROM shop_products WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BUG REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
async function getBugReports({ source, status, severity, limit = 50, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (source)   { where.push(`source = ?`);   params.push(source); }
  if (status)   { where.push(`status = ?`);   params.push(status); }
  if (severity) { where.push(`severity = ?`); params.push(severity); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    db.all(`SELECT * FROM bug_reports_v2 ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]),
    db.get(`SELECT COUNT(*) as total FROM bug_reports_v2 ${whereClause}`, params),
  ]);

  return { reports: rows || [], total: countRow?.total || 0 };
}

async function getBugReportById(id) {
  return db.get(`SELECT * FROM bug_reports_v2 WHERE id = ?`, [id]);
}

async function createBugReport(data) {
  const { source, reporter, email, title, description, severity, app_version, environment, logs, user_agent, ip_address } = data;
  const result = await db.run(`
    INSERT INTO bug_reports_v2 (source, reporter, email, title, description, severity, app_version, environment, logs, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [source || 'site', reporter, email, title, description, severity || 'medium', app_version, environment, logs, user_agent, ip_address]);
  return getBugReportById(result.lastID);
}

async function updateBugReport(id, { status, internal_notes, assigned_to, severity }) {
  await db.run(`
    UPDATE bug_reports_v2
    SET status = COALESCE(?, status),
        internal_notes = COALESCE(?, internal_notes),
        assigned_to = COALESCE(?, assigned_to),
        severity = COALESCE(?, severity),
        updated_at = datetime('now')
    WHERE id = ?
  `, [status, internal_notes, assigned_to, severity, id]);
  return getBugReportById(id);
}

async function deleteBugReport(id) {
  return db.run(`DELETE FROM bug_reports_v2 WHERE id = ?`, [id]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════════
async function logAudit({ admin_id, admin_email, action, category, target_type, target_id, old_value, new_value, ip_address, user_agent }) {
  return db.run(`
    INSERT INTO admin_audit_trail (admin_id, admin_email, action, category, target_type, target_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [admin_id, admin_email, action, category || 'general', target_type, target_id,
      old_value ? JSON.stringify(old_value) : null,
      new_value ? JSON.stringify(new_value) : null,
      ip_address, user_agent]);
}

async function getAuditLogs({ category, search, limit = 100, offset = 0 } = {}) {
  let where = [];
  let params = [];

  if (category) { where.push(`category = ?`); params.push(category); }
  if (search)   { where.push(`(action LIKE ? OR admin_email LIKE ? OR target_id LIKE ?)`); const q = `%${search}%`; params.push(q, q, q); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  return db.all(`
    SELECT * FROM admin_audit_trail ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLATFORM CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
async function getConfig() {
  const rows = await db.all(`SELECT * FROM platform_config ORDER BY key`);
  const config = {};
  for (const r of rows) { config[r.key] = r; }
  return config;
}

async function setConfig(key, value, updatedBy) {
  return db.run(`
    UPDATE platform_config SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?
  `, [String(value), updatedBy, key]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECURITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function forceLogoutAllUsers() {
  return db.run(`DELETE FROM sessions`);
}

async function getActiveSessions() {
  return db.get(`SELECT COUNT(*) as count FROM sessions WHERE (revoked_at IS NULL AND expires_at > datetime('now'))`);
}

module.exports = {
  // overview
  getOverviewStats,
  // announcements
  getAnnouncements, getAnnouncementById, createAnnouncement, updateAnnouncement, deleteAnnouncement, getNextAnnouncementVersion,
  // accounts
  getAccounts, getAccountById, updateAccountRole, setAccountPlan, banAccount, unbanAccount, deleteAccount, resetAccountPassword, getAccountSessions, getAccountDevices,
  // server accounts
  upsertServerAccount, searchServerAccounts, getServerAccountById, setServerPremium, setServerBlocked,
  // roles
  getAdminUsers, getAdminById, getRoles, getRolePermissions, setRolePermission, updateAdminRole, deleteAdmin,
  // polls
  getPolls, getPollById, createPoll, updatePoll, deletePoll,
  // tasks
  getTasks, getTaskById, createTask, updateTask, addTaskComment, deleteTask,
  // app updates
  getAppUpdates, getAppUpdateById, getLatestAppUpdate, getAllLatestUpdates, getAppUpdateHistory, createAppUpdate, deleteAppUpdate,
  // shop
  getShopProducts, getShopProductById, createShopProduct, updateShopProduct, setShopProductPublished, deleteShopProduct,
  // bug reports
  getBugReports, getBugReportById, createBugReport, updateBugReport, deleteBugReport,
  // audit
  logAudit, getAuditLogs,
  // config
  getConfig, setConfig,
  // security
  forceLogoutAllUsers, getActiveSessions,
};
