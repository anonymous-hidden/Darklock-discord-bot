# Admin Dashboard Migration Guide

**Version:** 2.0.0  
**Date:** January 26, 2026  
**Status:** Production Ready

---

## Executive Summary

This document describes the complete rebuild and modernization of the Darklock Admin Dashboard. The migration preserves the existing `/signin` authentication endpoint while introducing a modern, security-hardened admin interface with comprehensive maintenance mode controls.

---

## Authentication Contract (CRITICAL - DO NOT MODIFY)

### /signin Endpoint (PERMANENT)
```
URL: https://localhost:3000/signin
Method: GET (page) / POST (authenticate)
Status: PUBLIC (rate-limited)
```

**This is the ONLY admin login endpoint. Do NOT create duplicates.**

#### Post-Login Routing (Role-Based)
| Role | Redirect Target |
|------|-----------------|
| owner | /admin |
| admin | /admin |
| Platform user | /platform/dashboard |

---

## Route Architecture

### Old Routes (DEPRECATED)
| Route | File | Status |
|-------|------|--------|
| `/admin` | `darklock/views/admin.html` | Archived → `archive/legacy-admin/` |
| `/admin/dashboard` | Redirect to `/admin` | Removed |

### New Routes (v2)
| Route | Description | Auth | Role |
|-------|-------------|------|------|
| `/signin` | Admin login page | Public | - |
| `/signout` | Logout endpoint | Public | - |
| `/admin` | Main admin dashboard | Required | owner, admin |
| `/admin/maintenance` | Maintenance controls | Required | owner, admin |
| `/admin/services` | Service status management | Required | owner, admin |
| `/admin/users` | User/guild management | Required | owner, admin |
| `/admin/logs` | Audit logs viewer | Required | owner, admin |
| `/admin/config` | Feature flags & config | Required | owner |
| `/admin/security` | Security controls | Required | owner |

### API Routes (v2)
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | `/api/admin/dashboard` | Dashboard overview | owner, admin |
| GET | `/api/admin/system/health` | System health metrics | owner, admin |
| GET | `/api/admin/system/stats` | Live server stats | owner, admin |
| GET/PUT | `/api/admin/maintenance` | Maintenance settings | owner, admin |
| GET/PUT | `/api/admin/maintenance/scopes` | Scope-specific controls | owner, admin |
| POST | `/api/admin/maintenance/schedule` | Schedule maintenance | owner, admin |
| GET/POST | `/api/admin/service-status` | Service status | owner, admin |
| PUT | `/api/admin/service-status/:id` | Update service | owner, admin |
| GET | `/api/admin/audit-logs` | Audit logs (paginated) | owner, admin |
| GET/POST | `/api/admin/feature-flags` | Feature toggles | owner |
| PUT | `/api/admin/feature-flags/:id` | Update flag | owner |
| POST | `/api/admin/services/restart` | Restart service | owner |
| POST | `/api/admin/services/clear-cache` | Clear cache | owner |
| POST | `/api/admin/bot/resync-commands` | Resync bot commands | owner |
| POST | `/api/admin/bot/restart-shard` | Restart Discord shard | owner |
| GET | `/api/admin/users` | List platform users | owner, admin |
| POST | `/api/admin/users/:id/force-logout` | Force user logout | owner, admin |
| POST | `/api/admin/users/:id/suspend` | Suspend user access | owner |
| GET | `/api/admin/guilds` | List Discord guilds | owner, admin |
| POST | `/api/admin/guilds/:id/sync-config` | Force guild sync | owner, admin |

---

## Maintenance Mode Architecture

### Scope Configuration
Independent maintenance toggles for:
1. **Darklock Website** (`scope: 'website'`)
2. **Platform Dashboard** (`scope: 'platform'`)
3. **Discord Bot Dashboard** (`scope: 'bot_dashboard'`)
4. **API Routes** (`scope: 'api'`)
5. **Discord Bot** (`scope: 'discord_bot'`)

### Database Schema
```sql
CREATE TABLE maintenance_config (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 0,
    start_time TEXT,
    end_time TEXT,
    message TEXT,
    allow_admin_bypass INTEGER DEFAULT 1,
    allowed_ips TEXT,  -- JSON array
    created_by TEXT,
    created_at TEXT,
    updated_by TEXT,
    updated_at TEXT
);

CREATE TABLE maintenance_schedules (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scheduled_start TEXT NOT NULL,
    scheduled_end TEXT,
    message TEXT,
    notify_webhook TEXT,
    notify_discord INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT,
    executed INTEGER DEFAULT 0
);
```

### Enforcement Rules
1. **Server-side only** - Frontend checks are NOT security boundaries
2. **Blocks ALL access methods:**
   - Direct URL access
   - Cached sessions
   - Direct API calls
   - WebSocket connections
3. **Returns appropriate responses:**
   - Web requests → Maintenance page + countdown
   - API requests → HTTP 503 + JSON + `Retry-After` header

### Admin Bypass Logic
```javascript
// Admin bypass is ONLY allowed if:
// 1. User has valid admin_token cookie
// 2. Token type === 'admin'
// 3. Admin role is 'owner' or 'admin'
// 4. allow_admin_bypass is enabled for that scope
```

### /signin Behavior During Maintenance
- `/signin` **MUST remain accessible** at all times
- Non-admins: Show maintenance page AFTER login attempt
- Admins: Full access (bypass allowed)

---

## RBAC Permission Map

### Roles
| Role | Level | Description |
|------|-------|-------------|
| owner | 100 | Full system access |
| admin | 50 | Can manage most things, cannot manage other admins |
| editor | 25 | Content management only (not implemented in v2) |

### Permission Matrix
| Action | Owner | Admin | Notes |
|--------|-------|-------|-------|
| View dashboard | ✅ | ✅ | |
| View audit logs | ✅ | ✅ | |
| Manage maintenance | ✅ | ✅ | |
| Manage service status | ✅ | ✅ | |
| Manage feature flags | ✅ | ❌ | |
| Restart services | ✅ | ❌ | |
| Clear caches | ✅ | ❌ | |
| Rotate secrets | ✅ | ❌ | Requires typed confirmation |
| Force logout users | ✅ | ✅ | |
| Suspend users | ✅ | ❌ | |
| Manage other admins | ✅ | ❌ | |
| Bot shard control | ✅ | ❌ | |

---

## Rollback Procedure

### Step 1: Restore Legacy Dashboard
```bash
# Copy archived files back
cp archive/legacy-admin/admin.html darklock/views/admin.html
cp archive/legacy-admin/admin-dashboard.html darklock/views/admin-dashboard.html
```

### Step 2: Revert Route Changes
In `darklock/server.js`, restore the original `/admin` route handler.

### Step 3: Disable v2 API Routes
Comment out or remove the new API routes in `darklock/routes/admin-api.js`.

### Step 4: Restart Server
```bash
npm run restart
# or
pm2 restart all
```

---

## Verification Checklist

### No Hardcoded Data
- [ ] All stats fetched from database or live metrics
- [ ] No placeholder values in UI
- [ ] Service status reflects actual state
- [ ] User counts are live queries
- [ ] Timestamps are real-time

### No Dead Buttons
- [ ] Every button triggers an API call
- [ ] All toggles update database
- [ ] Success/error states shown
- [ ] Loading indicators present
- [ ] Confirmation dialogs for destructive actions

### Security Requirements
- [ ] All admin routes require authentication
- [ ] RBAC enforced on every endpoint
- [ ] All actions audit logged
- [ ] Rate limiting on sensitive endpoints
- [ ] CSRF protection enabled
- [ ] Secure headers configured
- [ ] Secrets masked in logs

### Maintenance Mode
- [ ] Server-side enforcement only
- [ ] Cannot bypass with cached sessions
- [ ] API returns 503 with Retry-After
- [ ] Countdown timer works
- [ ] Admin bypass functional
- [ ] Schedule system works

---

## Files Modified

### New Files
- `darklock/routes/admin-api-v2.js` - Enhanced admin API
- `darklock/views/admin-v2.html` - New admin dashboard
- `darklock/utils/maintenance-v2.js` - Enhanced maintenance module
- `darklock/public/js/admin-dashboard.js` - Frontend logic
- `darklock/public/css/admin-dashboard.css` - Styles

### Modified Files
- `darklock/server.js` - Route registration
- `darklock/utils/database.js` - Schema updates
- `darklock/routes/admin-auth.js` - Minor enhancements

### Archived Files
- `archive/legacy-admin/admin.html`
- `archive/legacy-admin/admin-dashboard.html`

---

## Deployment Plan

### Phase 1: Parallel Deployment
1. Deploy new dashboard at `/admin-v2` (temporary)
2. Keep legacy dashboard at `/admin`
3. Test all functionality in production

### Phase 2: Cutover
1. Verify feature parity
2. Update `/admin` to serve new dashboard
3. Redirect `/admin-v2` to `/admin`
4. Monitor for issues

### Phase 3: Cleanup
1. Remove `/admin-v2` route after 1 release cycle
2. Delete legacy files (not archive)
3. Update documentation

---

## Support

For issues with the admin dashboard migration:
1. Check this document's rollback procedure
2. Review audit logs for error details
3. Contact the development team

**Never modify the `/signin` endpoint without explicit approval.**
