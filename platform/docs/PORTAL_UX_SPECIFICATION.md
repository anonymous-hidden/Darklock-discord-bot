# Darklock Platform Portal - UX Specification

**Version:** 1.0.0  
**Date:** January 29, 2026  
**Design System:** Darklock Cyberpunk Premium (Inherited from Guard v2)

---

## Design Foundation

### Color Tokens (Matching Guard v2)

```css
/* Backgrounds */
--bg-primary: #0a0e17;
--bg-secondary: #0f1420;
--bg-card: rgba(21, 28, 44, 0.7);
--bg-card-solid: #1a2235;

/* Accents */
--accent-primary: #00f0ff;    /* Cyan */
--accent-secondary: #7c3aed;  /* Purple */
--accent-tertiary: #ec4899;   /* Pink */

/* Text */
--text-primary: #ffffff;
--text-secondary: #94a3b8;
--text-muted: #64748b;

/* Semantic */
--success: #10b981;
--warning: #f59e0b;
--error: #ef4444;
--info: #00f0ff;

/* Special States */
--zerotrust: #ec4899;         /* Pink for Zero-Trust badges */
--offline: #64748b;           /* Gray for offline devices */
--online: #10b981;            /* Green for online devices */

/* Borders */
--border-color: rgba(148, 163, 184, 0.1);
--border-glow: rgba(0, 240, 255, 0.3);
```

### Typography

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

--text-xs: 0.75rem;      /* 12px */
--text-sm: 0.875rem;     /* 14px */
--text-base: 1rem;       /* 16px */
--text-lg: 1.125rem;     /* 18px */
--text-xl: 1.25rem;      /* 20px */
--text-2xl: 1.5rem;      /* 24px */
```

### Spacing & Components

```css
--space-sm: 0.5rem;      /* 8px */
--space-md: 1rem;        /* 16px */
--space-lg: 1.5rem;      /* 24px */
--space-xl: 2rem;        /* 32px */

--radius-sm: 0.375rem;   /* 6px - badges */
--radius-md: 0.5rem;     /* 8px - buttons */
--radius-lg: 0.75rem;    /* 12px - cards */
```

---

## Portal Navigation Structure

```
┌──────────────────────────────────────────────────────┐
│ TOPBAR                                               │
│ [Darklock Platform] ············ [Account] [Logout] │
├──────┬───────────────────────────────────────────────┤
│      │                                               │
│ NAV  │         PAGE CONTENT                          │
│      │                                               │
│ Home │                                               │
│ →Updates                                             │
│ Devices                                              │
│ Logs                                                 │
│ API Keys                                             │
│                                                       │
└──────┴───────────────────────────────────────────────┘
```

---

## 1. /updates - Release Management

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│ UPDATES                                              [+ New] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ FILTERS                                              │   │
│ │ Product: [All ▼] [Guard] [Bot]                      │   │
│ │ OS: [All ▼] [Windows] [Linux] [macOS]              │   │
│ │ Channel: [All ▼] [Stable] [Beta]                   │   │
│ │ Version: [________Search________]       [Clear All] │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌────────────────────────────────────────────────────┐     │
│ │ ┌──────────────────────────────────────────────┐   │     │
│ │ │ 🛡️ Guard v2.1.0 for Windows (Stable)         │   │     │
│ │ │ Released: Jan 28, 2026 • 45.2 MB            │   │     │
│ │ │                                              │   │     │
│ │ │ ✓ Signature Valid (ed25519)                 │   │     │
│ │ │ ✓ SHA-256: a3f2...d9c1                      │   │     │
│ │ │                                              │   │     │
│ │ │ CHANGELOG                                    │   │     │
│ │ │ • Added: Connected mode device linking      │   │     │
│ │ │ • Fixed: Vault unlock race condition        │   │     │
│ │ │ • Security: Enhanced anti-tamper checks     │   │     │
│ │ │ [View Full Notes ▼]                         │   │     │
│ │ │                                              │   │     │
│ │ │ [Download .exe] [Download .sig] [Copy URL] │   │     │
│ │ └──────────────────────────────────────────────┘   │     │
│ │                                                    │     │
│ │ ┌──────────────────────────────────────────────┐   │     │
│ │ │ 🛡️ Guard v2.0.5 for Linux (Stable)          │   │     │
│ │ │ Released: Jan 20, 2026 • 38.7 MB            │   │     │
│ │ │                                              │   │     │
│ │ │ ✓ Signature Valid (ed25519)                 │   │     │
│ │ │ ✓ SHA-256: 92bd...4e7f                      │   │     │
│ │ │                                              │   │     │
│ │ │ CHANGELOG                                    │   │     │
│ │ │ • Fixed: Service crash on Wayland           │   │     │
│ │ │ • Improved: IPC socket cleanup               │   │     │
│ │ │                                              │   │     │
│ │ │ [Download .tar.gz] [Download .sig] [Copy]  │   │     │
│ │ └──────────────────────────────────────────────┘   │     │
│ └────────────────────────────────────────────────────┘     │
│                                                              │
│ [Load More] (23 releases total)                             │
└──────────────────────────────────────────────────────────────┘
```

### Component Specifications

#### Filter Bar

**Structure:**
- Horizontal layout, left-aligned
- Each filter: Label + Dropdown/Multi-select
- "Clear All" button on far right (text-secondary, hover cyan)

**Dropdowns:**
- Product: All, Guard, Bot
- OS: All, Windows, Linux, macOS
- Channel: All, Stable, Beta
- Version search: Text input, live filter (debounced 300ms)

**Interactions:**
- Filter changes trigger immediate list update
- Active filters show count badge: "Product (2)"
- Hover: `border-glow` on focused input

#### Release Card

**Visual Hierarchy:**
```
┌─────────────────────────────────────────────┐
│ [Product Icon] [Name] [Version] [Channel]  │  ← Header row
│ [Released Date] • [File Size]              │  ← Meta row
│                                             │
│ [Verification Status]                       │  ← Security row
│ ✓ Signature Valid | ✓ SHA-256: hash...    │
│                                             │
│ CHANGELOG                                   │  ← Content
│ • Change 1                                  │
│ • Change 2                                  │
│ [View Full Notes ▼] (collapsed by default) │
│                                             │
│ [Download] [Download .sig] [Copy URL]      │  ← Actions
└─────────────────────────────────────────────┘
```

**Styling:**
- Background: `bg-card` with `border: 1px solid border-color`
- Border radius: `radius-lg`
- Padding: `space-lg`
- Hover: `border-glow` + `shadow-md`

**Header Row:**
- Product icon: 24px, colored (Guard = cyan shield, Bot = purple bot icon)
- Name: `text-lg`, `font-semibold`, `text-primary`
- Version: `font-mono`, `text-base`, badge style (bg cyan/purple)
- Channel badge: Pill shape
  - Stable: Green background, `#10b981`
  - Beta: Amber background, `#f59e0b`

**Meta Row:**
- Text: `text-sm`, `text-secondary`
- Date: Relative ("2 days ago") with full date on hover tooltip
- File size: MB with 1 decimal

**Verification Row:**
- Checkmark icons: Green `#10b981` if valid, Red `#ef4444` if invalid
- Signature status:
  - ✓ Valid: Green text, green checkmark
  - ✗ Invalid: Red text, red X icon, + warning banner
  - ⊘ Missing: Gray text, "Not signed"
- SHA-256 hash: `font-mono`, `text-xs`, truncated with "..." (full on hover)
  - Click to copy (shows toast "Hash copied")

**Changelog Section:**
- Bullet list, `text-sm`, `text-secondary`
- Each item: `• [Type]: Description`
  - Added: Cyan bullet `#00f0ff`
  - Fixed: Green bullet `#10b981`
  - Security: Pink bullet `#ec4899`
  - Changed: Purple bullet `#7c3aed`
- Collapse toggle: "View Full Notes ▼" / "Collapse ▲"
  - Default: Show first 3 items, rest collapsed
  - Expanded: Show all, smooth height animation

**Action Buttons:**
- Primary button: "Download [.exe/.tar.gz/.dmg]" - Cyan, filled
- Secondary: "Download .sig" - Outline style
- Tertiary: "Copy URL" - Text only, shows tooltip "Copied!" on click

**Interactions:**
- Download button: Shows loading spinner if clicked
- Invalid signature: Red border around entire card + warning icon in header
- Beta channel: Amber border-left (4px) to visually distinguish

### Empty States

#### No Releases Match Filters

```
┌─────────────────────────────────────────┐
│                                         │
│         🔍                              │
│                                         │
│    No releases found                    │
│                                         │
│    Try adjusting your filters or        │
│    clearing all to see all releases.    │
│                                         │
│    [Clear All Filters]                  │
│                                         │
└─────────────────────────────────────────┘
```

**Styling:**
- Centered content, `text-center`
- Icon: `text-6xl`, `text-muted`
- Heading: `text-xl`, `text-primary`
- Body: `text-base`, `text-secondary`
- Button: Primary style, cyan

#### No Releases Exist (New Installation)

```
┌─────────────────────────────────────────┐
│                                         │
│         📦                              │
│                                         │
│    No releases yet                      │
│                                         │
│    Upload your first release to make    │
│    it available for downloads.          │
│                                         │
│    [+ Upload Release]                   │
│                                         │
└─────────────────────────────────────────┘
```

### Error States

#### Failed to Load Releases

```
┌─────────────────────────────────────────┐
│                                         │
│         ⚠️                              │
│                                         │
│    Failed to load releases              │
│                                         │
│    We couldn't fetch the release list.  │
│    Please check your connection and     │
│    try again.                           │
│                                         │
│    [Retry]                              │
│                                         │
└─────────────────────────────────────────┘
```

**Styling:**
- Icon: Amber `#f59e0b`
- Error banner at top of page (optional): Red background, white text
- Retry button: Primary style

#### Invalid/Tampered Release (Critical)

When a release has an invalid signature, the entire card gets special styling:

```
┌─────────────────────────────────────────┐
│ ⚠️ SIGNATURE VERIFICATION FAILED        │  ← Red banner at top
├─────────────────────────────────────────┤
│ 🛡️ Guard v2.1.0 for Windows            │
│ Released: Jan 28, 2026 • 45.2 MB       │
│                                         │
│ ✗ Signature Invalid                     │  ← Red X
│ ✗ SHA-256: Mismatch                     │
│                                         │
│ ⚠️ Do not download this release.        │
│    It may have been tampered with.      │
│    Contact support immediately.         │
│                                         │
│ [Report Issue] [Download Anyway]        │  ← Danger button
└─────────────────────────────────────────┘
```

**Special styling:**
- Red border: `border: 2px solid var(--error)`
- Red banner: `bg-error`, `text-white`, full width at top of card
- Warning section: Red background `rgba(239, 68, 68, 0.1)`
- "Download Anyway" button: 
  - Requires confirmation dialog
  - Red outline, not filled
  - Shows scary warning on hover

---

## 2. /devices - Device List

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│ DEVICES                                   [Refresh] [+ Link] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ FILTERS & SEARCH                                     │   │
│ │ [________Search by Device ID or Name________]        │   │
│ │ Status: [All ▼] [Online] [Offline]                  │   │
│ │ Profile: [All ▼] [Normal] [Zero-Trust]              │   │
│ │ [Clear]                                              │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌─────────────────────────────────────────────────────┐    │
│ │ DEVICE LIST                                         │    │
│ │                                                     │    │
│ │ ┌───────────────────────────────────────────────┐  │    │
│ │ │ 🖥️  Device-ABCD-1234                         │  │    │
│ │ │                                              │  │    │
│ │ │ [●] Online • Normal                          │  │    │
│ │ │ Last seen: 2 minutes ago                     │  │    │
│ │ │ Linked: Jan 15, 2026                         │  │    │
│ │ │                                              │  │    │
│ │ │ [View Details →]                             │  │    │
│ │ └───────────────────────────────────────────────┘  │    │
│ │                                                     │    │
│ │ ┌───────────────────────────────────────────────┐  │    │
│ │ │ 🖥️  Device-EFGH-5678                         │  │    │
│ │ │                                              │  │    │
│ │ │ [●] Offline • Zero-Trust                     │  │    │
│ │ │ Last seen: 3 hours ago                       │  │    │
│ │ │ Linked: Jan 10, 2026                         │  │    │
│ │ │                                              │  │    │
│ │ │ [View Details →]                             │  │    │
│ │ └───────────────────────────────────────────────┘  │    │
│ │                                                     │    │
│ │ ┌───────────────────────────────────────────────┐  │    │
│ │ │ 🖥️  Device-IJKL-9012  [VIEW-ONLY]           │  │    │
│ │ │                                              │  │    │
│ │ │ [○] Offline • Normal                         │  │    │
│ │ │ Last seen: 5 days ago                        │  │    │
│ │ │ Linked: Dec 20, 2025                         │  │    │
│ │ │                                              │  │    │
│ │ │ [View Details →]                             │  │    │
│ │ └───────────────────────────────────────────────┘  │    │
│ └─────────────────────────────────────────────────────┘    │
│                                                              │
│ Showing 3 of 3 devices                                       │
└──────────────────────────────────────────────────────────────┘
```

### Component Specifications

#### Device Card

**Visual Structure:**
```
┌─────────────────────────────────────────┐
│ [Icon] [Device ID] [Badges]             │  ← Header
│                                         │
│ [Status Dot] [Status] • [Profile]      │  ← Status row
│ Last seen: [Time]                       │  ← Meta
│ Linked: [Date]                          │
│                                         │
│ [View Details →]                        │  ← Action
└─────────────────────────────────────────┘
```

**Styling:**
- Background: `bg-card`
- Border: `1px solid border-color`
- Border radius: `radius-lg`
- Padding: `space-lg`
- Hover: `border-glow` + slight lift `translateY(-2px)`

**Header:**
- Icon: Desktop/laptop icon, 20px, `text-secondary`
- Device ID: `text-lg`, `font-mono`, `text-primary`
- Badges (right-aligned):
  - View-only: Gray pill, `bg-muted`, `text-xs`, "VIEW-ONLY"
  - Zero-Trust: Pink pill, `bg-zerotrust`, `text-white`, "ZERO-TRUST"

**Status Row:**
- Status dot (8px circle):
  - Online: Pulsing green `#10b981` with glow animation
  - Offline: Solid gray `#64748b`
- Status text: 
  - Online: Green, `font-semibold`
  - Offline: Gray
- Profile badge:
  - Normal: No special styling, just text
  - Zero-Trust: Pink text with shield icon

**Meta Row:**
- Text: `text-sm`, `text-secondary`
- Last seen:
  - Online: "X minutes/hours ago" in green
  - Offline: "X hours/days ago" in gray
  - Long offline (>7 days): Amber text with warning icon
- Linked date: Absolute date "Jan 15, 2026"

**Action Button:**
- Style: Text link with arrow →
- Color: Cyan on hover
- Full card is clickable (entire surface)

### Empty States

#### No Devices Linked

```
┌─────────────────────────────────────────┐
│                                         │
│         🔗                              │
│                                         │
│    No devices linked                    │
│                                         │
│    Link your first device to start      │
│    managing it remotely.                │
│                                         │
│    [+ Link Device]                      │
│                                         │
└─────────────────────────────────────────┘
```

#### No Devices Match Filters

```
┌─────────────────────────────────────────┐
│                                         │
│         🔍                              │
│                                         │
│    No devices found                     │
│                                         │
│    No devices match your current        │
│    filters. Try adjusting them.         │
│                                         │
│    [Clear Filters]                      │
│                                         │
└─────────────────────────────────────────┘
```

### Error States

#### Failed to Load Devices

```
┌─────────────────────────────────────────┐
│                                         │
│         ⚠️                              │
│                                         │
│    Failed to load devices               │
│                                         │
│    Could not retrieve device list.      │
│    Please try again.                    │
│                                         │
│    [Retry]                              │
│                                         │
└─────────────────────────────────────────┘
```

---

## 3. /devices/:id - Device Detail Page

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│ ← Back to Devices                                            │
├──────────────────────────────────────────────────────────────┤
│ DEVICE-ABCD-1234                      [●] Online • Normal    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌────────────────────────┐  ┌──────────────────────────┐   │
│ │ DEVICE OVERVIEW        │  │ ACTIONS                  │   │
│ │                        │  │                          │   │
│ │ Device ID              │  │ [Force Update]           │   │
│ │ ABCD-1234-EFGH-5678    │  │ [Enter Safe Mode]        │   │
│ │                        │  │ [Refresh Config]         │   │
│ │ Linked At              │  │ [Request Logs]           │   │
│ │ Jan 15, 2026 14:32 UTC │  │ [Revoke Device]          │   │
│ │                        │  │                          │   │
│ │ Last Heartbeat         │  │ ⓘ Final authority        │   │
│ │ 2 minutes ago          │  │   resides on device;     │   │
│ │ (Jan 29, 15:40 UTC)    │  │   actions may be         │   │
│ │                        │  │   rejected.              │   │
│ │ Security Profile       │  └──────────────────────────┘   │
│ │ Normal                 │                                 │
│ │                        │                                 │
│ │ Mode                   │                                 │
│ │ Connected              │                                 │
│ │                        │                                 │
│ │ Public Key (ed25519)   │                                 │
│ │ [Copy] a3f2d9c1...     │                                 │
│ └────────────────────────┘                                 │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ RECENT EVENTS                          [View All]    │   │
│ │                                                      │   │
│ │ • 15:40 UTC — Heartbeat received                    │   │
│ │ • 15:10 UTC — Heartbeat received                    │   │
│ │ • 14:55 UTC — Command received: refresh_config      │   │
│ │ • 14:55 UTC — Command completed: refresh_config     │   │
│ │ • 14:32 UTC — Device linked                         │   │
│ │                                                      │   │
│ │ [Load More]                                          │   │
│ └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Zero-Trust Device Variation

**For ZERO_TRUST devices, the Actions panel changes:**

```
┌──────────────────────────────────────┐
│ ACTIONS                              │
│                                      │
│ ⚠️ REMOTE ACTIONS DISABLED           │
│                                      │
│ This device uses Zero-Trust mode.    │
│ Remote commands are blocked by       │
│ device policy for maximum security.  │
│                                      │
│ The device owner must perform all    │
│ actions locally.                     │
│                                      │
│ [View-Only Access]                   │  ← Disabled button
└──────────────────────────────────────┘
```

**Styling:**
- Banner: Amber/pink gradient background
- Warning icon: `#ec4899`
- Text: `text-sm`, left-aligned
- All action buttons hidden/removed
- Optional: Show grayed-out buttons with strikethrough + tooltip

### Component Specifications

#### Device Overview Panel

**Card Styling:**
- Background: `bg-card-solid`
- Border: `1px solid border-color`
- Padding: `space-xl`

**Data Rows:**
```
[Label]                    ← text-sm, text-secondary
[Value]                    ← text-base, text-primary, font-mono for IDs
```

**Field Specifications:**

1. **Device ID**
   - Font: Monospace
   - Copy button: Icon only, shows tooltip "Copy" → "Copied!"

2. **Linked At**
   - Format: "MMM DD, YYYY HH:MM UTC"
   - Tooltip on hover: Relative time "15 days ago"

3. **Last Heartbeat**
   - Primary: Relative time "2 minutes ago"
   - Secondary (muted): Absolute timestamp
   - Color coding:
     - <5 min: Green
     - 5-30 min: Cyan
     - 30min-1hr: Amber
     - >1hr: Red

4. **Security Profile**
   - Badge style for Zero-Trust (pink pill)
   - Normal: Plain text

5. **Mode**
   - "Connected" or "Local"
   - Connected: Cyan badge
   - Local: Gray badge

6. **Public Key**
   - Truncated display: "a3f2d9c1...7e8f" (first 8 + last 4 chars)
   - Copy button reveals full key
   - Font: Monospace

#### Actions Panel (Normal Mode)

**Card Styling:**
- Same as overview panel
- Buttons: Vertical stack, full width

**Button Hierarchy:**
1. **Force Update** - Primary (cyan), icon: download
2. **Enter Safe Mode** - Warning (amber), icon: shield
3. **Refresh Config** - Secondary (outline), icon: refresh
4. **Request Logs** - Secondary (outline), icon: file-text
5. **Revoke Device** - Danger (red outline), icon: trash

**Microcopy Footer:**
```
ⓘ Final authority resides on device;
  actions may be rejected.
```
- Icon: Info circle, cyan
- Text: `text-xs`, `text-muted`, italic
- Background: `rgba(0, 240, 255, 0.05)` (subtle cyan tint)
- Padding: `space-sm`
- Border radius: `radius-sm`

**Button Interactions:**
- Hover: Glow effect matching button color
- Click: Shows confirmation dialog (see below)
- Loading: Button shows spinner, text changes to "Sending..."
- Success: Green checkmark animation, toast notification
- Failure: Red X animation, error message below button

#### Actions Panel (Zero-Trust Mode)

**Banner:**
- Background: Linear gradient `rgba(236, 72, 153, 0.1)` to `rgba(124, 58, 237, 0.05)`
- Border: `2px solid var(--zerotrust)`
- Icon: Large warning triangle, pink
- Text: `text-sm`, centered

**Disabled Button (Optional Display):**
- Grayed out, not clickable
- Text: "View-Only Access"
- Tooltip on hover: "Zero-Trust devices do not accept remote commands."

#### Recent Events List

**Event Row Structure:**
```
• [Timestamp] — [Event Description]
```

**Styling:**
- Font: `text-sm`
- Timestamp: `font-mono`, `text-secondary`
- Description: `text-primary`
- Icon/dot: Color-coded by event type
  - Heartbeat: Green dot
  - Command: Cyan dot
  - Error: Red dot
  - Link/Unlink: Purple dot

**Event Types:**
- Heartbeat received
- Command received: [command_name]
- Command completed: [command_name]
- Command failed: [command_name] - [reason]
- Device linked
- Device revoked
- Configuration updated

**Interactions:**
- Click event row to expand details (if available)
- "View All" button links to full events page/modal
- "Load More" button loads next 20 events

### Confirmation Dialogs

#### Force Update Confirmation

```
┌─────────────────────────────────────────┐
│ Force Update?                           │
├─────────────────────────────────────────┤
│                                         │
│ This will command the device to check   │
│ for and install any available updates.  │
│                                         │
│ The device may restart during the       │
│ update process.                         │
│                                         │
│ ⚠️ Note: The device may reject this     │
│    command based on its security        │
│    policy.                              │
│                                         │
│         [Cancel]  [Force Update]        │
└─────────────────────────────────────────┘
```

**Styling:**
- Modal: `bg-card-solid`, `shadow-xl`
- Warning section: Amber background `rgba(245, 158, 11, 0.1)`
- Cancel button: Secondary (outline)
- Confirm button: Primary (cyan, filled)

#### Enter Safe Mode Confirmation

```
┌─────────────────────────────────────────┐
│ Enter Safe Mode?                        │
├─────────────────────────────────────────┤
│                                         │
│ This will put the device into Safe Mode,│
│ disabling most protection features.     │
│                                         │
│ Use this only for troubleshooting.      │
│                                         │
│ ⚠️ Security Warning:                    │
│    The device will be in a degraded     │
│    state until Safe Mode is exited.     │
│                                         │
│ ⚠️ Device Policy:                       │
│    The device may reject this command.  │
│                                         │
│         [Cancel]  [Enter Safe Mode]     │
└─────────────────────────────────────────┘
```

**Styling:**
- Two warning sections, both amber background
- Confirm button: Warning style (amber, filled)

#### Revoke Device Confirmation (DANGER)

```
┌─────────────────────────────────────────┐
│ Revoke Device Access?                   │
├─────────────────────────────────────────┤
│                                         │
│ 🚨 DESTRUCTIVE ACTION                   │
│                                         │
│ This will permanently revoke this       │
│ device's access to the platform.        │
│                                         │
│ The device will no longer:              │
│ • Receive commands                      │
│ • Send heartbeats                       │
│ • Access cloud features                 │
│                                         │
│ This action CANNOT be undone. The       │
│ device must be re-linked manually.      │
│                                         │
│ Type the device ID to confirm:          │
│ [_____________________________]         │
│                                         │
│         [Cancel]  [Revoke Device]       │
└─────────────────────────────────────────┘
```

**Styling:**
- Danger banner: Red background, white text
- Input field: Must match device ID exactly
- Confirm button: Disabled until input matches
- Confirm button: Red filled, "REVOKE" text

#### Refresh Config Confirmation

```
┌─────────────────────────────────────────┐
│ Refresh Configuration?                  │
├─────────────────────────────────────────┤
│                                         │
│ This will command the device to re-read │
│ its configuration from the vault.       │
│                                         │
│ No data will be lost.                   │
│                                         │
│ ⓘ Note: The device may reject this      │
│   command based on its security policy. │
│                                         │
│         [Cancel]  [Refresh Config]      │
└─────────────────────────────────────────┘
```

**Styling:**
- Info section: Cyan background `rgba(0, 240, 255, 0.05)`
- Confirm button: Primary (cyan, filled)

#### Request Logs Confirmation

```
┌─────────────────────────────────────────┐
│ Request Device Logs?                    │
├─────────────────────────────────────────┤
│                                         │
│ This will ask the device to upload its  │
│ event logs to the platform for review.  │
│                                         │
│ Logs may contain sensitive information  │
│ about device activity and files.        │
│                                         │
│ ⓘ Privacy: Logs are encrypted in        │
│   transit and stored securely.          │
│                                         │
│ ⚠️ Device Policy:                       │
│    The device may reject this command.  │
│                                         │
│         [Cancel]  [Request Logs]        │
└─────────────────────────────────────────┘
```

**Styling:**
- Privacy section: Cyan info background
- Device policy section: Amber warning background
- Confirm button: Primary (cyan, filled)

### Success & Error States

#### Command Sent Successfully

**Toast Notification (top-right corner):**
```
┌─────────────────────────────────┐
│ ✓ Command Sent                  │
│   The device will process it    │
│   on the next poll.             │
└─────────────────────────────────┘
```

**Styling:**
- Background: `rgba(16, 185, 129, 0.9)` (green translucent)
- Text: White
- Icon: Checkmark
- Auto-dismiss: 4 seconds
- Position: Top-right, slide-in animation

#### Command Failed

**Toast Notification:**
```
┌─────────────────────────────────┐
│ ✗ Command Failed                │
│   Could not send command.       │
│   [Retry]                       │
└─────────────────────────────────┘
```

**Styling:**
- Background: `rgba(239, 68, 68, 0.9)` (red translucent)
- Text: White
- Icon: X
- Retry button: White outline
- Auto-dismiss: 8 seconds (longer for errors)

#### Device Rejected Command

**Banner at top of page (persistent until dismissed):**
```
┌────────────────────────────────────────────────┐
│ ⚠️ Command Rejected by Device                  │
│                                                │
│ The device refused the "Force Update" command  │
│ due to its security policy.                    │
│                                                │
│ [View Event Log] [Dismiss]                     │
└────────────────────────────────────────────────┘
```

**Styling:**
- Background: Amber `rgba(245, 158, 11, 0.15)`
- Border: Amber `2px solid #f59e0b`
- Full width, above content
- Dismissible with X button

### Empty States

#### No Events Yet

```
┌─────────────────────────────────────────┐
│                                         │
│         📋                              │
│                                         │
│    No events recorded                   │
│                                         │
│    Events will appear here once the     │
│    device sends its first heartbeat.    │
│                                         │
└─────────────────────────────────────────┘
```

### Error States

#### Failed to Load Device

```
┌─────────────────────────────────────────┐
│                                         │
│         ⚠️                              │
│                                         │
│    Device not found                     │
│                                         │
│    This device may have been revoked    │
│    or the ID is incorrect.              │
│                                         │
│    [← Back to Devices]                  │
│                                         │
└─────────────────────────────────────────┘
```

#### Device Offline for Extended Period

**Warning Banner (shown if last heartbeat >24 hours):**
```
┌────────────────────────────────────────────────┐
│ ⚠️ Device Offline                              │
│                                                │
│ This device hasn't sent a heartbeat in 3 days. │
│ It may be powered off or disconnected.         │
│                                                │
│ Remote actions will not work until the device  │
│ comes back online.                             │
│                                                │
│ [Dismiss]                                      │
└────────────────────────────────────────────────┘
```

**Styling:**
- Background: Amber gradient
- Icon: Warning triangle
- Shown at top of device detail page
- Dismissible but re-appears on page reload if still offline

---

## Global UI Patterns

### Badges

#### Security Profile Badges

**Normal:**
- Background: Transparent
- Text: Gray `#94a3b8`
- Border: None
- Size: Small pill

**Zero-Trust:**
- Background: Pink `#ec4899`
- Text: White
- Icon: Shield
- Size: Small pill
- Glow: Subtle pink shadow

#### Status Badges

**Online:**
- Dot: Pulsing green `#10b981`
- Text: "Online" in green
- Animation: Pulse glow every 2s

**Offline:**
- Dot: Solid gray `#64748b`
- Text: "Offline" in gray
- No animation

#### Channel Badges

**Stable:**
- Background: Green `#10b981`
- Text: White
- Text: "STABLE"

**Beta:**
- Background: Amber `#f59e0b`
- Text: White
- Text: "BETA"

### Loading States

#### Skeleton Loaders

Use for initial page load:

**Device Card Skeleton:**
```
┌─────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░                     │
│                                         │
│ ░░░░░░ ░░░░░░░░                        │
│ ░░░░░░░░░░░░░░░                        │
│ ░░░░░░░░░░░░░░░                        │
│                                         │
│ ░░░░░░░░░░░░                           │
└─────────────────────────────────────────┘
```

**Styling:**
- Shimmer animation from left to right
- Background: `rgba(148, 163, 184, 0.1)`
- Animation duration: 1.5s, infinite

#### Inline Loaders

For button actions:
- Replace button text with spinner
- Spinner: Cyan, 16px
- Button stays same size (no layout shift)

### Tooltips

**Standard Tooltip:**
- Background: `rgba(15, 20, 32, 0.95)` (dark, translucent)
- Text: White, `text-xs`
- Border: `1px solid border-color`
- Arrow: Pointing to hovered element
- Appear: 500ms delay
- Max width: 200px

**Examples:**
- Copy button: "Copy to clipboard" → "Copied!"
- Disabled action: "This action requires the device to be online."
- Info icon: Detailed explanation text

### Animations

#### Card Hover

```css
.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.2);
  border-color: var(--border-glow);
  transition: all 250ms ease;
}
```

#### Status Pulse (Online Indicator)

```css
@keyframes pulse-online {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  }
  50% {
    opacity: 0.8;
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
  }
}
```

#### Slide-In (Notifications/Toasts)

```css
@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

---

## Responsive Breakpoints

### Desktop (1200px+)
- Full sidebar navigation
- Multi-column layouts
- Side-by-side panels

### Tablet (768px - 1199px)
- Collapsible sidebar (icon-only)
- Single column for most content
- Stacked panels

### Mobile (<768px)
- Bottom navigation bar
- Full-width cards
- Stacked everything
- Touch-optimized button sizes (min 44px height)

---

## Accessibility

### Keyboard Navigation
- All interactive elements: `tabindex` in logical order
- Focus indicators: Cyan glow `border-glow`
- Escape key: Closes modals/dialogs
- Enter key: Confirms focused buttons

### Screen Readers
- All icons: `aria-label` or accompanying text
- Loading states: `aria-live="polite"`
- Error messages: `aria-live="assertive"`
- Status indicators: Announced as "Online" or "Offline"

### Color Contrast
- All text meets WCAG AA standards (4.5:1 minimum)
- Status indicators: Don't rely on color alone (use icons + text)
- Error states: Red text + icon + descriptive message

---

## Microcopy Glossary

### Banners

**Zero-Trust Remote Actions Banner:**
```
⚠️ REMOTE ACTIONS DISABLED

This device uses Zero-Trust mode. Remote commands are blocked by device 
policy for maximum security. The device owner must perform all actions 
locally.
```

**Device Authority Footer:**
```
ⓘ Final authority resides on device; actions may be rejected.
```

**Extended Offline Warning:**
```
⚠️ Device Offline

This device hasn't sent a heartbeat in [X days]. It may be powered off 
or disconnected. Remote actions will not work until the device comes 
back online.
```

**Invalid Signature Warning:**
```
⚠️ SIGNATURE VERIFICATION FAILED

Do not download this release. It may have been tampered with. Contact 
support immediately.
```

### Tooltips

**Disabled Action (Device Offline):**
```
This action requires the device to be online.
```

**Disabled Action (Zero-Trust):**
```
Zero-Trust devices do not accept remote commands.
```

**Copy Button:**
```
Copy to clipboard
→ (after click) Copied!
```

**View-Only Badge:**
```
You have read-only access to this device.
```

**Beta Channel Filter:**
```
Beta releases may be unstable. Use with caution.
```

### Confirmation Dialogs

**Generic Cancellation:**
```
Cancel
```

**Generic Confirmation:**
```
[Action Name] (e.g., "Force Update", "Revoke Device")
```

**Destructive Action Explanation:**
```
This action CANNOT be undone.
```

**Device Policy Note:**
```
⚠️ Note: The device may reject this command based on its security policy.
```

### Empty States

**No Devices:**
```
No devices linked

Link your first device to start managing it remotely.

[+ Link Device]
```

**No Releases:**
```
No releases yet

Upload your first release to make it available for downloads.

[+ Upload Release]
```

**No Events:**
```
No events recorded

Events will appear here once the device sends its first heartbeat.
```

**No Matching Filters:**
```
No [items] found

No [items] match your current filters. Try adjusting them.

[Clear Filters]
```

### Error Messages

**Network Error:**
```
Failed to load [resource]

Could not retrieve [resource]. Please check your connection and try again.

[Retry]
```

**Not Found:**
```
[Resource] not found

This [resource] may have been revoked or the ID is incorrect.

[← Back to [List]]
```

**Validation Error:**
```
Invalid input

[Specific error, e.g., "Device ID must match exactly"]
```

**Server Error:**
```
Something went wrong

An unexpected error occurred. Please try again or contact support if the 
problem persists.

[Retry]
```

---

## Summary of Key Design Decisions

1. **Zero-Trust Prominence**: Pink badges and banners immediately signal when remote actions are disabled, maintaining honest communication about device policies.

2. **Authority Transparency**: Every action context includes the microcopy "Final authority resides on device; actions may be rejected" to set proper expectations.

3. **Status Clarity**: Online/offline states use both color AND animation (pulsing glow) to be accessible and visually clear.

4. **Signature Verification First**: Release cards prominently display signature status with visual hierarchy (checkmarks/X's) before download buttons.

5. **Progressive Disclosure**: Changelog sections default to collapsed (first 3 items) to keep the list scannable, but expand on demand.

6. **Fail-Visible**: Invalid signatures get red borders, warning banners, and require explicit "Download Anyway" confirmation.

7. **Confirmation Patterns**: Dangerous actions (Revoke) require typing the device ID; medium-risk actions (Safe Mode) show warnings; low-risk actions (Refresh Config) use simple confirms.

8. **Empty State Guidance**: All empty states provide clear next actions (Link Device, Upload Release, etc.) rather than just stating absence.

9. **Consistent Badge System**: Security profiles, channels, and statuses all use the same pill-badge component with color-coding.

10. **Keyboard & Accessibility**: Full keyboard navigation, WCAG AA contrast, screen reader labels throughout.
