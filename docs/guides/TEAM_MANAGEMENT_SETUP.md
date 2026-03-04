# Team Management Setup - Complete ✅

## Overview
Added comprehensive team management and role permissions system to the admin panel with full RBAC (Role-Based Access Control).

## Changes Made

### 1. Backend API (`darklock/routes/team-management.js`)
**New File Created** - Complete backend implementation

**Features:**
- **Role Hierarchy System:**
  - Owner (level 5) - Protected, cannot be modified
  - Co-Owner (level 4)
  - Admin (level 3)
  - Moderator (level 2)
  - Helper (level 1)

- **Team Management API Routes:**
  - `GET /api/team` - Get all team members
  - `POST /api/team` - Add new team member
  - `PUT /api/team/:id` - Update team member
  - `DELETE /api/team/:id` - Remove team member
  - `GET /api/team/permissions` - Get role permissions
  - `PUT /api/team/permissions` - Update role permission

- **Security Features:**
  - Hierarchical permission checks (can't modify higher roles)
  - Owner role is completely protected
  - Email uniqueness validation
  - Automatic admin tracking (added_by field)

- **10 Permissions:**
  1. canViewLogs
  2. canManageTickets
  3. canWarnUsers
  4. canKickUsers
  5. canBanUsers
  6. canManageRoles
  7. canManageServer
  8. canAccessDashboard
  9. canViewAnalytics
  10. canManageBot

- **Role Presets:**
  - Each role has predefined permission sets
  - Owner: All permissions enabled
  - Co-Owner: All except bot management
  - Admin: Dashboard, analytics, server management
  - Mod: User moderation (warn, kick, ban)
  - Helper: View logs, manage tickets

### 2. Server Integration (`darklock/server.js`)
**Modified** - Integrated team management routes

**Changes:**
- Line ~51: Added require for team-management module
- Line ~823: Registered `/api/team` routes
- Line ~1014: Initialize team schema on server start

### 3. Frontend UI (`darklock/views/admin-v2.html`)
**Modified** - Complete frontend implementation

**Changes:**

#### Navigation (Lines ~866-886):
- Added "Team Management" nav item with user-shield icon
- Added "Role Permissions" nav item with key icon

#### Team Management Page (Lines ~1088-1218):
- Page header with "Add Member" button
- Team members table showing:
  - Username
  - Email
  - Role (with color-coded badges)
  - Discord ID
  - Added By
  - Added At (timestamp)
  - Actions (Edit/Delete buttons)
- Role hierarchy cards (5 cards with descriptions)

#### Role Permissions Page (Lines ~1220-1310):
- Dynamic permissions grid (table format)
- 10 permissions × 5 roles = 50 checkboxes
- Owner permissions locked (disabled checkboxes)
- Permission descriptions table
- Refresh button

#### Modals (Lines ~1519-1599):
- **Add Team Member Modal:**
  - Email input (required)
  - Username input (optional)
  - Role dropdown (helper/mod/admin/co-owner only)
  - Discord ID input (optional)
  
- **Edit Team Member Modal:**
  - Same fields as add modal
  - Pre-populated with existing data
  - Update button

#### JavaScript Functions (Lines ~2408-2566):
- `loadTeamMembers()` - Fetch and display all team members
- `openAddMemberModal()` - Open add member modal
- `closeAddMemberModal()` - Close add member modal
- `openEditMemberModal()` - Open edit modal with data
- `closeEditMemberModal()` - Close edit modal
- `addTeamMember()` - Submit new member form
- `updateMember()` - Submit edit member form
- `removeMember()` - Delete team member with confirmation
- `loadRolePermissions()` - Fetch and display permissions grid
- `updatePermission()` - Toggle single permission
- `applyPreset()` - Apply role preset (if needed later)

#### Navigation Integration (Line ~1717):
- Added cases for 'team-management' and 'role-permissions' pages
- Auto-refresh every 30 seconds when on these pages

#### Styles (Lines ~828-869):
- Role hierarchy grid layout
- Role card styling (color borders per role)
- Permission grid checkbox styling
- Responsive mobile layout

## Database Schema

### team_members Table
```sql
CREATE TABLE team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT,
    role TEXT NOT NULL,
    discord_id TEXT,
    added_by TEXT,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

### role_permissions Table
```sql
CREATE TABLE role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT UNIQUE NOT NULL,
    canViewLogs INTEGER DEFAULT 0,
    canManageTickets INTEGER DEFAULT 0,
    canWarnUsers INTEGER DEFAULT 0,
    canKickUsers INTEGER DEFAULT 0,
    canBanUsers INTEGER DEFAULT 0,
    canManageRoles INTEGER DEFAULT 0,
    canManageServer INTEGER DEFAULT 0,
    canAccessDashboard INTEGER DEFAULT 0,
    canViewAnalytics INTEGER DEFAULT 0,
    canManageBot INTEGER DEFAULT 0
)
```

## Testing Instructions

### 1. Local Testing (Before Deploying to Pi)
```bash
cd "/home/cayden/discord bot/discord bot"
npm start
```

Then open: http://localhost:3001/admin

**Test Team Management:**
1. Click "Team Management" tab in sidebar
2. Click "Add Member" button
3. Fill in:
   - Email: test@darklock.net
   - Username: Test User
   - Role: helper
   - Discord ID: 123456789 (optional)
4. Submit and verify member appears in table
5. Click Edit button, change role to "mod"
6. Click Delete button, confirm removal works

**Test Role Permissions:**
1. Click "Role Permissions" tab in sidebar
2. Verify permissions grid displays with 5 columns (roles)
3. Toggle a permission for "helper" role
4. Verify it saves (green success toast)
5. Refresh page and verify change persisted
6. Try toggling owner permissions (should be disabled)

### 2. Deploy to Raspberry Pi
When you're home and can access the Pi:

```bash
# Copy updated files
scp darklock/server.js ubuntu@192.168.50.2:/home/ubuntu/discord-bot/darklock/
scp darklock/routes/team-management.js ubuntu@192.168.50.2:/home/ubuntu/discord-bot/darklock/routes/
scp darklock/views/admin-v2.html ubuntu@192.168.50.2:/home/ubuntu/discord-bot/darklock/views/

# SSH into Pi and restart service
ssh ubuntu@192.168.50.2
sudo systemctl restart discord-bot.service
sudo systemctl status discord-bot.service

# Check logs for errors
sudo journalctl -u discord-bot.service -n 50
```

### 3. Test on Pi
Once deployed:
- Local: http://192.168.50.2:3001/admin
- Remote (when DNS propagates): https://darklock.net/admin

## Security Features

✅ **Owner Protection:** Owner role cannot be added, edited, or deleted  
✅ **Hierarchical Access:** Lower roles can't modify higher roles  
✅ **Email Validation:** Unique emails enforced  
✅ **Permission Inheritance:** Role presets ensure sensible defaults  
✅ **Audit Trail:** Tracks who added each member  
✅ **Confirmation Dialogs:** Destructive actions require confirmation  

## Color Coding

- 🔴 **Owner** - Red badge (`badge-danger`)
- 🟡 **Co-Owner** - Yellow badge (`badge-warning`)
- 🔵 **Admin** - Blue badge (`badge-primary`)
- 🟢 **Moderator** - Green badge (`badge-success`)
- ⚪ **Helper** - Light blue badge (`badge-info`)

## Files Modified/Created

### Created:
- `darklock/routes/team-management.js` (370 lines)

### Modified:
- `darklock/server.js` (3 sections)
- `darklock/views/admin-v2.html` (500+ lines added)

## Next Steps

1. ✅ Test locally at http://localhost:3001/admin
2. ⏳ Deploy to Pi when home
3. ⏳ Test on Pi after deployment
4. ⏳ Wait for darklock.net DNS to propagate (1-24 hours)
5. ⏳ Test on https://darklock.net/admin

## Troubleshooting

**If modals don't appear:**
- Check browser console for JavaScript errors
- Verify modal CSS is loaded (`.modal { display: none; }`)

**If API calls fail:**
- Check `/api/team` route is registered in server.js
- Verify team-management.js exists in darklock/routes/
- Check server logs: `sudo journalctl -u discord-bot.service -n 50`

**If permissions don't save:**
- Verify darklock.db has write permissions
- Check role_permissions table exists
- Ensure initializeTeamSchema() was called on startup

**If owner role shows action buttons:**
- Verify role comparison is exact: `member.role !== 'owner'`
- Check team member data from API response

## Notes

- All changes are saved locally and ready to deploy
- Database tables will auto-create on first server start
- Owner role is hardcoded as protected in backend
- Permission changes are immediate (no page refresh needed)
- Auto-refresh every 30 seconds when viewing team pages
- Mobile responsive design included
