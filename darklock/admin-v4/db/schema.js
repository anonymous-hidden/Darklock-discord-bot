/**
 * Darklock Admin v4 — Database Schema
 * Consolidated schema for the redesigned admin dashboard.
 *
 * Tables managed here:
 *   admin_roles           – RBAC role definitions
 *   admin_permissions     – granular permission flags per role
 *   admin_audit_trail     – unified admin action log
 *   platform_announcements – announcements / release notes
 *   app_updates           – pushed app update records
 *   shop_products         – publishable Ridgeline shop catalog
 *   bug_reports_v2        – bug reports from site + desktop app
 *   platform_config       – key/value platform settings
 *
 * Existing tables we READ (not modify):
 *   admins, users, sessions, updates, admin_audit_logs
 */

'use strict';

const db = require('../../utils/database');

// ── Role hierarchy ──────────────────────────────────────────────────────────────
const ROLE_HIERARCHY = {
  owner:   100,
  coowner:  90,
  admin:    70,
  pr:       60,
  mod:      50,
  bug_tester: 45,
  helper:   30,
};

// ── Default permissions per role ────────────────────────────────────────────────
const DEFAULT_PERMISSIONS = {
  owner:   { '*': true },
  coowner: {
    overview: true,
    tickets: true,
    platform_updates: true,
    polls: true,
    tasks: true,
    bug_reports: true,
    'bug_reports.manage': true,
    accounts: true,
    'accounts.server_lookup': true,
    'accounts.server_premium': true,
    'accounts.server_block': true,
    roles: true,
    'roles.create': true,
    'roles.edit': true,
    'roles.remove': true,
    app_updates: true,
    system_logs: true,
    security: true,
    settings: true,
  },
  admin: {
    overview: true,
    tickets: true,
    platform_updates: true,
    polls: true,
    tasks: true,
    bug_reports: true,
    'bug_reports.manage': true,
    accounts: true,
    'accounts.server_lookup': true,
    app_updates: true,
    system_logs: true,
  },
  pr: {
    overview: true,
    platform_updates: true,
    tasks: true,
    'tasks.request': true,
  },
  mod: {
    overview: true,
    tickets: true,
    tasks: true,
    bug_reports: true,
    system_logs: true,
  },
  bug_tester: {
    overview: true,
    bug_reports: true,
    tasks: true,
  },
  helper: {
    overview: true,
    bug_reports: true,
  },
};

// ── Schema initializer ──────────────────────────────────────────────────────────
async function initializeV4Schema() {
  // admin_roles — canonical role definitions
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_roles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      level       INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // admin_permissions — per-role permission flags
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id     TEXT NOT NULL REFERENCES admin_roles(id),
      permission  TEXT NOT NULL,
      granted     INTEGER NOT NULL DEFAULT 1,
      UNIQUE(role_id, permission)
    )
  `);

  // admin_audit_trail — unified action log
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_audit_trail (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    TEXT NOT NULL,
      admin_email TEXT,
      action      TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'general',
      target_type TEXT,
      target_id   TEXT,
      old_value   TEXT,
      new_value   TEXT,
      ip_address  TEXT,
      user_agent  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_admin    ON admin_audit_trail(admin_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_category ON admin_audit_trail(category)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_audit_created  ON admin_audit_trail(created_at)`);

  // platform_announcements
  await db.run(`
    CREATE TABLE IF NOT EXISTS platform_announcements (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      version     TEXT,
      category    TEXT NOT NULL DEFAULT 'update',
      status      TEXT NOT NULL DEFAULT 'published',
      visibility  TEXT NOT NULL DEFAULT 'public',
      pinned      INTEGER NOT NULL DEFAULT 0,
      author_id   TEXT,
      author_email TEXT,
      published_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`ALTER TABLE platform_announcements ADD COLUMN category TEXT NOT NULL DEFAULT 'update'`).catch(() => {});
  await db.run(`ALTER TABLE platform_announcements ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`).catch(() => {});
  await db.run(`ALTER TABLE platform_announcements ADD COLUMN published_at TEXT`).catch(() => {});

  // app_updates — pushed update records for all Darklock apps
  await db.run(`
    CREATE TABLE IF NOT EXISTS app_updates (
      id              TEXT PRIMARY KEY,
      app             TEXT NOT NULL DEFAULT 'secure-guard',
      version         TEXT NOT NULL,
      title           TEXT NOT NULL,
      changelog       TEXT,
      download_url    TEXT,
      force_update    INTEGER NOT NULL DEFAULT 0,
      min_version     TEXT,
      channel         TEXT NOT NULL DEFAULT 'stable',
      platform        TEXT,
      file_size       TEXT,
      published_by    TEXT,
      published_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app, version)
    )
  `);
  // Migrate existing app_updates table to add new columns if missing
  await db.run(`ALTER TABLE app_updates ADD COLUMN app TEXT NOT NULL DEFAULT 'secure-guard'`).catch(() => {});
  await db.run(`ALTER TABLE app_updates ADD COLUMN platform TEXT`).catch(() => {});
  await db.run(`ALTER TABLE app_updates ADD COLUMN file_size TEXT`).catch(() => {});
  // Migrate existing app_updates table to add channel column if missing
  await db.run(`ALTER TABLE app_updates ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable'`).catch(() => {});

  // Polls (shared with /platform/polls)
  await db.run(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'feature',
      status TEXT DEFAULT 'draft',
      created_by TEXT NOT NULL,
      updated_by TEXT,
      published_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME,
      archived_at DATETIME,
      expires_at DATETIME
    )
  `);
  await db.run(`ALTER TABLE polls ADD COLUMN updated_by TEXT`).catch(() => {});
  await db.run(`ALTER TABLE polls ADD COLUMN published_by TEXT`).catch(() => {});
  await db.run(`ALTER TABLE polls ADD COLUMN published_at DATETIME`).catch(() => {});
  await db.run(`ALTER TABLE polls ADD COLUMN archived_at DATETIME`).catch(() => {});

  await db.run(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_text TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(poll_id, user_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_polls_created_at ON polls(created_at)`);

  // Migrate admins table — add columns introduced by admin-v4 that may not exist
  // in databases created by the legacy admin-auth.js schema
  await db.run(`ALTER TABLE admins ADD COLUMN username TEXT`).catch(() => {});
  await db.run(`ALTER TABLE admins ADD COLUMN display_name TEXT`).catch(() => {});
  await db.run(`ALTER TABLE admins ADD COLUMN avatar TEXT`).catch(() => {});
  await db.run(`ALTER TABLE admins ADD COLUMN require_2fa INTEGER DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE admins ADD COLUMN rfid_card_name TEXT`).catch(() => {});
  // Back-fill display_name from email prefix where NULL
  await db.run(`UPDATE admins SET display_name = SUBSTR(email, 1, INSTR(email, '@') - 1) WHERE display_name IS NULL`).catch(() => {});

  // Admin tasks
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'requested',
      category TEXT,
      assigned_role TEXT,
      assigned_user_id TEXT,
      requested_by TEXT,
      created_by TEXT NOT NULL,
      approved_by TEXT,
      due_date TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_tasks_status ON admin_tasks(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_tasks_assigned_role ON admin_tasks(assigned_role)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_tasks_assigned_user ON admin_tasks(assigned_user_id)`);

  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      admin_id TEXT,
      admin_email TEXT,
      comment TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES admin_tasks(id) ON DELETE CASCADE
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_task_comments_task ON admin_task_comments(task_id, created_at)`);

  // Server account controls for Accounts tab
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_server_accounts (
      server_id TEXT PRIMARY KEY,
      server_name TEXT,
      owner_user_id TEXT,
      premium_active INTEGER NOT NULL DEFAULT 0,
      premium_expires_at TEXT,
      premium_plan TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      bot_joined INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_server_accounts_name ON admin_server_accounts(server_name)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_server_accounts_owner ON admin_server_accounts(owner_user_id)`);

  // User subscription plans for Accounts tab plan management
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_user_plans (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      assigned_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_admin_user_plans_plan ON admin_user_plans(plan)`);

  // bug_reports_v2 — aggregated from site + desktop app
  await db.run(`
    CREATE TABLE IF NOT EXISTS bug_reports_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL DEFAULT 'site',
      reporter    TEXT,
      email       TEXT,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'medium',
      status      TEXT NOT NULL DEFAULT 'open',
      app_version TEXT,
      environment TEXT,
      logs        TEXT,
      internal_notes TEXT,
      assigned_to TEXT,
      user_agent  TEXT,
      ip_address  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_bugs_status  ON bug_reports_v2(status)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_v4_bugs_source  ON bug_reports_v2(source)`);

  // shop_products — admin-managed storefront catalog
  await db.run(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id              TEXT PRIMARY KEY,
      app             TEXT NOT NULL DEFAULT 'ridgeline',
      slug            TEXT UNIQUE,
      title           TEXT NOT NULL,
      subtitle        TEXT,
      description     TEXT,
      image_url       TEXT,
      badge           TEXT,
      price_cents     INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'usd',
      billing_type    TEXT NOT NULL DEFAULT 'one_time',
      stripe_price_id TEXT,
      features_json   TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      published       INTEGER NOT NULL DEFAULT 0,
      published_by    TEXT,
      published_at    TEXT,
      created_by      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_shop_products_app ON shop_products(app)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_shop_products_published ON shop_products(published)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_shop_products_sort ON shop_products(sort_order, created_at)`);

  // Backward-compatible migrations for older installations
  await db.run(`ALTER TABLE shop_products ADD COLUMN stripe_price_id TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN subtitle TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN description TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN image_url TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN badge TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN currency TEXT NOT NULL DEFAULT 'usd'`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'one_time'`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN features_json TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN published INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN published_by TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN published_at TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN created_by TEXT`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`).catch(() => {});
  await db.run(`ALTER TABLE shop_products ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))`).catch(() => {});

  // platform_config — key/value settings
  await db.run(`
    CREATE TABLE IF NOT EXISTS platform_config (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      type        TEXT NOT NULL DEFAULT 'string',
      description TEXT,
      updated_by  TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Seed roles ──────────────────────────────────────────────────────────────
  for (const [name, level] of Object.entries(ROLE_HIERARCHY)) {
    await db.run(`
      INSERT OR IGNORE INTO admin_roles (id, name, level, description)
      VALUES (?, ?, ?, ?)
    `, [name, name, level, `${name} role`]);
  }

  // ── Seed permissions ────────────────────────────────────────────────────────
  for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    for (const [perm, granted] of Object.entries(perms)) {
      await db.run(`
        INSERT OR IGNORE INTO admin_permissions (role_id, permission, granted)
        VALUES (?, ?, ?)
      `, [role, perm, granted ? 1 : 0]);
    }
  }

  // ── Seed default config ─────────────────────────────────────────────────────
  const defaults = [
    ['platform_name',          'Darklock',                     'string', 'Platform display name'],
    ['contact_email',          'support@darklock.net',         'string', 'Contact email address'],
    ['registration_enabled',   'true',                         'boolean', 'Allow new user signups'],
    ['email_verification',     'false',                        'boolean', 'Require email verification'],
    ['maintenance_mode',       'false',                        'boolean', 'Global maintenance mode'],
    ['maintenance_message',    'We\'ll be back shortly.',      'string', 'Maintenance page message'],
    ['free_tier_file_limit',   '10',                           'number', 'Max protected files for free users'],
    ['premium_tier_file_limit','unlimited',                     'string', 'Max protected files for premium'],
    ['current_app_version',    '2.0.0',                        'string', 'Latest published app version'],
  ];
  for (const [key, value, type, desc] of defaults) {
    await db.run(`
      INSERT OR IGNORE INTO platform_config (key, value, type, description)
      VALUES (?, ?, ?, ?)
    `, [key, value, type, desc]);
  }

  // ── Analytics: custom charts (Premium) ─────────────────────────────────────
  await db.run(`
    CREATE TABLE IF NOT EXISTS analytics_custom_charts (
      id              TEXT PRIMARY KEY,
      admin_id        TEXT NOT NULL,
      title           TEXT NOT NULL,
      chart_type      TEXT NOT NULL DEFAULT 'bar',
      primary_metric  TEXT NOT NULL,
      secondary_metric TEXT,
      group_by        TEXT NOT NULL DEFAULT 'day',
      aggregation     TEXT NOT NULL DEFAULT 'count',
      color_theme     TEXT NOT NULL DEFAULT 'indigo',
      show_legend     INTEGER NOT NULL DEFAULT 1,
      show_tooltips   INTEGER NOT NULL DEFAULT 1,
      show_trend_line INTEGER NOT NULL DEFAULT 0,
      position        INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_analytics_cc_admin ON analytics_custom_charts(admin_id)`);

  // ── Analytics: saved dashboard layouts (Premium) ──────────────────────────
  await db.run(`
    CREATE TABLE IF NOT EXISTS analytics_layouts (
      admin_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      layout      TEXT NOT NULL DEFAULT '{}',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (admin_id, name)
    )
  `);

  console.log('[Admin v4] Schema initialized successfully');
}

module.exports = {
  initializeV4Schema,
  ROLE_HIERARCHY,
  DEFAULT_PERMISSIONS,
};
