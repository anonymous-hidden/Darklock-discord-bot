# Reaction Roles System

## Overview
A comprehensive reaction roles system supporting both **classic emoji reactions** and **modern Discord buttons**.

## Features

### 🎯 Two Interaction Types
- **Reaction-based**: Users react to messages with emojis to get roles
- **Button-based**: Users click buttons below messages to get roles

### 🎛️ Assignment Modes
- **Multiple Mode**: Users can have multiple roles from the panel
- **Single Mode**: Selecting one role removes others from the same panel

### 🛡️ Security
- Blocks assignment of dangerous roles (Administrator, Manage Guild, etc.)
- Prevents assigning roles higher than bot's position
- Blocks managed roles (bot roles, integrations)
- Position checks to prevent privilege escalation

## Commands

### `/reactionroles list`
Shows all roles in the server with their positions and permissions.

### `/reactionroles create`
Creates a new reaction role panel.
- **title**: Panel title (shown at the top)
- **description**: Panel description (optional)
- **type**: `reaction` or `button`
- **mode**: `single` (one role at a time) or `multiple` (many roles allowed)

### `/reactionroles add`
Adds a role to an existing panel.
- **panel_id**: The panel ID (e.g., `rr_123456`)
- **role**: The role to add
- **emoji**: For reactions: emoji to use. For buttons: button label
- **description**: Optional role description

### `/reactionroles remove`
Removes a role from a panel.
- **panel_id**: The panel ID
- **role**: The role to remove

### `/reactionroles deploy`
Deploys the panel to a channel.
- **panel_id**: The panel ID
- **channel**: Target channel

This will:
- Send the message with title and description
- Add reactions (for reaction panels) or buttons (for button panels)
- Start tracking user interactions

### `/reactionroles delete`
Deletes an entire panel and all its mappings.

### `/reactionroles panels`
Lists all panels in the server with their details.

## Database Schema

### `reaction_role_panels`
Stores panel configurations.
```sql
CREATE TABLE reaction_role_panels (
    panel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,           -- 'reaction' or 'button'
    title TEXT NOT NULL,
    description TEXT,
    mode TEXT NOT NULL,            -- 'single' or 'multiple'
    channel_id TEXT,
    message_id TEXT,
    created_by TEXT NOT NULL,
    deployed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### `reaction_role_mappings`
Stores role-emoji/button associations.
```sql
CREATE TABLE reaction_role_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    emoji TEXT,                    -- emoji or button label
    description TEXT,
    FOREIGN KEY(panel_id) REFERENCES reaction_role_panels(panel_id) ON DELETE CASCADE
);
```

## Event Handlers

### `messageReactionAdd.js`
Handles when users react to messages:
1. Checks if the message is a reaction role panel
2. Validates the emoji matches a configured role
3. In single mode: removes other roles from the same panel
4. Assigns the role to the user
5. Sends a DM confirmation

### `messageReactionRemove.js`
Handles when users remove their reaction:
1. Finds the associated role
2. Removes the role from the user

### `reactionRoleButtons.js`
Handles button clicks:
1. Parses button ID (`rr_{panelId}_{roleId}`)
2. Toggles the role (adds if missing, removes if present)
3. In single mode: removes other roles before adding
4. Sends ephemeral confirmation

## Integration

The system is integrated into the main bot:
- **Commands**: Loaded from `src/commands/roles.js`
- **Events**: Handlers called from `src/bot.js` event listeners
- **Database**: Tables in `src/database/database.js`

## Bot Intents Required
```javascript
GatewayIntentBits.GuildMessageReactions  // For reaction events
GatewayIntentBits.Guilds                  // For role management
GatewayIntentBits.GuildMembers            // For role assignment
```

Already enabled in the bot configuration.

## Example Usage

### Creating a Game Roles Panel (Buttons)
```
/reactionroles create title:"Game Roles" description:"Select your game roles" type:button mode:multiple
```

This returns a panel ID like `rr_1234567890`

### Adding Roles to the Panel
```
/reactionroles add panel_id:rr_1234567890 role:@Valorant emoji:"🎮 Valorant" description:"Valorant players"
/reactionroles add panel_id:rr_1234567890 role:@League emoji:"🏆 League" description:"League of Legends players"
/reactionroles add panel_id:rr_1234567890 role:@Minecraft emoji:"⛏️ Minecraft" description:"Minecraft players"
```

### Deploying the Panel
```
/reactionroles deploy panel_id:rr_1234567890 channel:#roles
```

Users can now click the buttons to get/remove roles!

### Creating a Color Roles Panel (Reactions, Single Mode)
```
/reactionroles create title:"Choose Your Color" type:reaction mode:single
/reactionroles add panel_id:rr_0987654321 role:@Red emoji:🔴
/reactionroles add panel_id:rr_0987654321 role:@Blue emoji:🔵
/reactionroles add panel_id:rr_0987654321 role:@Green emoji:🟢
/reactionroles deploy panel_id:rr_0987654321 channel:#roles
```

Users react with an emoji to get that color role. In single mode, reacting with a different emoji automatically removes the old color role.

## Notes

- Button panels have a limit of 25 buttons (5 rows × 5 buttons)
- Reaction panels support any valid Unicode emoji
- Custom emojis work for reactions (use `<:name:id>` format)
- DM confirmations may fail if user has DMs disabled
- Ephemeral responses for button interactions ensure privacy
