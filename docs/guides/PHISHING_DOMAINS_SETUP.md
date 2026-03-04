# Anti-Phishing Domain Database Setup

## 📋 Overview

The DarkLock bot now includes a comprehensive **anti-phishing system** that checks messages for malicious links and blocks them before they can harm your server members.

## 🔧 What Was Added

### 1. **Database Table: `malicious_links`**
   - Stores phishing/malicious domains
   - Already created in your database
   - Columns: url, threat_type, severity, source, verified, whitelisted, timestamps

### 2. **LinkAnalyzer Integration**
   - Automatically loads domains from database on startup
   - Checks every message for malicious links
   - Updates domain list every hour
   - **Location**: `src/security/LinkAnalyzer.js`

### 3. **Import Script: `import-phishing-domains.js`**
   - Bulk imports phishing domains from JSON file
   - Batch processing for efficient imports
   - Duplicate detection
   - Progress reporting

## 📥 How to Import Phishing Domains

### Step 1: Save Your Domains File

Your `Untitled-1` file contains the phishing domains. Save it as a JSON file:

1. **In VS Code**: 
   - Open `Untitled-1` file
   - Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac)
   - Save as: `phishing-domains.json`

### Step 2: Run the Import Script

```bash
node import-phishing-domains.js phishing-domains.json
```

### Expected Output:

```
🔒 Phishing Domains Import Tool
================================

📂 Domains file: phishing-domains.json
💾 Database: /home/cayden/discord bot/discord bot/data/darklock.db

✅ Loaded XXXXX domains from file
✅ Connected to database
✅ Table verified/created

📥 Starting import...

   Progress: 1000/XXXXX domains (X%)
   Progress: 2000/XXXXX domains (X%)
   ...

================================
✅ Import Complete!

📊 Statistics:
   • Total domains: XXXXX
   • Imported: XXXXX
   • Skipped (duplicates): 0
   • Errors: 0

📋 Sample entries:
   1. 1000-rewards.xyz (PHISHING, severity: 9)
   2. 101nitro.com (PHISHING, severity: 9)
   ...

💾 Total domains in database: XXXXX

✅ Done!
```

## 🚀 Testing the System

### 1. Start the Bot

```bash
npm start
```

**Look for these log messages:**
```
[LinkAnalyzer] Loaded XXXXX phishing domains from database (total: XXXXX)
[LinkAnalyzer] Initialized with XXXXX phishing domains
   ✅ Link Analyzer initialized
```

### 2. Test a Phishing Link

Send a message in Discord with a known phishing domain (from your list):
```
Check out this cool site: https://discord-giveaway.com/free-nitro
```

**Expected Result:**
- Message will be deleted
- User may receive a warning/timeout (depending on your antilinks settings)
- Security log will show the blocked link

### 3. Check the Dashboard

- Go to `http://localhost:3001/setup/antilinks`
- Verify anti-links protection is enabled
- Configure actions (delete, warn, timeout, etc.)

## 🔄 How It Works

### Message Flow:

```
User sends message
    ↓
messageCreate event fires
    ↓
bot.linkAnalyzer.analyzeMessage(message)
    ↓
Extracts URLs from message
    ↓
Checks each domain against:
    • Hardcoded phishing list (12 domains)
    • Database phishing list (YOUR IMPORTED LIST)
    • IP logger domains
    • URL shorteners
    • Lookalike domains
    • Unicode spoofing
    ↓
If malicious → Delete/Warn/Timeout/Ban
    ↓
Log to database & dashboard
```

### Auto-Refresh:

- LinkAnalyzer reloads database domains **every hour**
- You can add domains manually to the database
- Changes take effect within 1 hour (or restart bot)

## 📝 Manual Domain Management

### Add a Single Domain:

```sql
sqlite3 data/darklock.db

INSERT INTO malicious_links 
(url, threat_type, severity, source, verified)
VALUES 
('evil-domain.com', 'PHISHING', 9, 'manual', 1);
```

### Remove a Domain:

```sql
DELETE FROM malicious_links WHERE url = 'false-positive.com';
```

### Whitelist a Domain:

```sql
UPDATE malicious_links 
SET whitelisted = 1 
WHERE url = 'safe-domain.com';
```

### View All Domains:

```sql
SELECT url, threat_type, severity, source 
FROM malicious_links 
ORDER BY created_at DESC 
LIMIT 50;
```

## 🎛️ Configuration

### Guild Config Settings (in dashboard):

- **`anti_links_enabled`**: Enable/disable link protection
- **`antilinks_bypass_roles`**: Roles that bypass link filtering
- **`antilinks_bypass_channels`**: Channels where links are allowed
- **`antilinks_action`**: delete, warn, timeout, kick, ban
- **`antilinks_timeout_duration`**: Timeout duration in seconds

### Environment Variables (optional):

```bash
# Google Safe Browsing API (for additional protection)
SAFE_BROWSING_API_KEY=your_api_key_here
```

## 🔍 Monitoring

### Check Database Stats:

```bash
sqlite3 data/darklock.db "SELECT COUNT(*) as total FROM malicious_links;"
```

### View Recent Blocks:

```bash
sqlite3 data/darklock.db "SELECT * FROM security_logs WHERE event_type = 'malicious_link' ORDER BY created_at DESC LIMIT 10;"
```

### Export Domains:

```bash
sqlite3 -csv data/darklock.db "SELECT url FROM malicious_links WHERE threat_type = 'PHISHING';" > exported-domains.csv
```

## 🛡️ Security Notes

1. **Severity Levels**: 
   - Imported domains are set to severity **9** (high risk)
   - Scale: 1-10 (10 = critical)

2. **Verified Status**:
   - Imported domains marked as `verified = 1` (trusted source)
   - Manually added domains should set appropriately

3. **Whitelist Override**:
   - Setting `whitelisted = 1` bypasses all checks
   - Use carefully for false positives

4. **Source Tracking**:
   - All imported domains tagged with `source = 'imported_list'`
   - Helps track domain origins

## 🚨 Troubleshooting

### Import Failed?

- **Error: "Database connection failed"**
  → Check `data/darklock.db` exists
  → Ensure no other process has database locked

- **Error: "Invalid JSON format"**
  → Verify JSON file structure: `{ "domains": [...] }`
  → Check for syntax errors in JSON

### Links Not Being Blocked?

1. Check `anti_links_enabled` in guild config
2. Verify user doesn't have bypass role
3. Check channel isn't in bypass list
4. Review bot logs for errors
5. Confirm domain is in database:
   ```bash
   sqlite3 data/darklock.db "SELECT * FROM malicious_links WHERE url = 'suspicious-domain.com';"
   ```

### Bot Not Starting?

- **"LinkAnalyzer initialization failed"**: Check database permissions
- Regenerate tamper protection baseline (already done)

## 📚 Additional Resources

- **LinkAnalyzer Code**: `src/security/LinkAnalyzer.js`
- **Message Handler**: `src/events/messageCreate.js` (line 92)
- **Import Script**: `import-phishing-domains.js`
- **Database Schema**: `src/database/database.js` (line 865)

## 🎉 Next Steps

1. **Import your domains** (see Step 1 & 2 above)
2. **Start the bot** and watch the logs
3. **Test with a known phishing link**
4. **Configure actions** in the dashboard
5. **Monitor the security logs**

---

**Need help?** Check the bot logs for detailed information about link analysis and blocking actions.
