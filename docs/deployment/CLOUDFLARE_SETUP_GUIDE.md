# 🌐 Cloudflare Setup Guide for Darklock Platform

**Last Updated:** February 14, 2026  
**Pi5 Status:** ✅ All services running, tunnel configured

---

## 📋 Current Setup on Pi5

Your Raspberry Pi 5 is now running these services:

| Service | Port | Status | Description |
|---------|------|--------|-------------|
| **Discord Bot Dashboard** | 3001 | ✅ Running | Main dashboard, team management |
| **Darklock Admin v4** | 3002 | ✅ Running | Enterprise admin panel (NEW) |
| **XP Leaderboard** | 3007 | ✅ Running | XP tracking dashboard |
| **RFID Gateway** | 9999 | ✅ Running | Security card reader |
| **Cloudflare Tunnel** | - | ✅ Running | Exposes services to internet |

---

## 🎯 Cloudflare Tunnel Routes (Already Configured)

Your tunnel is already routing these domains to your Pi5:

```yaml
darklock.net           → http://localhost:3001  (Discord bot)
www.darklock.net       → http://localhost:3001  
admin.darklock.net     → http://localhost:3002  (Admin v4) ⭐ NEW
platform.darklock.net  → http://localhost:3002  (Admin v4) ⭐ NEW
xp.darklock.net        → http://localhost:3007  (XP leaderboard)
api.darklock.net       → http://localhost:3001  (API endpoints)
```

---

## 🚀 Step-by-Step: Add DNS Records in Cloudflare

### Step 1: Log in to Cloudflare Dashboard
1. Go to https://dash.cloudflare.com
2. Log in with your Cloudflare account
3. Click on your domain: **darklock.net**

### Step 2: Navigate to DNS Settings
1. In the left sidebar, click **DNS** (or **DNS Records**)
2. You should see the "DNS Management" page

### Step 3: Add CNAME Records (Manual Method)

For **each subdomain**, add a CNAME record:

#### Record 1: admin.darklock.net

```
Type:    CNAME
Name:    admin
Target:  aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com
TTL:     Auto
Proxy:   ✅ Proxied (Orange cloud ON)
```

**Steps:**
- Click **Add record** button
- Select **CNAME** from Type dropdown
- Enter `admin` in the Name field
- Enter `aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com` in Target field
- Make sure **Proxy status** is ON (orange cloud ☁️)
- Click **Save**

#### Record 2: platform.darklock.net

```
Type:    CNAME
Name:    platform
Target:  aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com
TTL:     Auto
Proxy:   ✅ Proxied (Orange cloud ON)
```

### Step 4: Verify Existing Records

Make sure these records already exist (they should if tunnel is working):

```
www.darklock.net       → CNAME → aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com
xp.darklock.net        → CNAME → aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com
api.darklock.net       → CNAME → aa269442-1a8a-4485-8423-bbd64c36ff59.cfargotunnel.com
```

For the root domain (`darklock.net`), you should have either:
- A CNAME to the tunnel, OR
- An A record pointing to Cloudflare's proxy IP

---

## ⚡ Alternative: Add Records via Command Line (Faster)

If you have **cloudflared** installed on your local machine, you can add records automatically:

```bash
# Install cloudflared (if not already installed)
# On macOS:
brew install cloudflare/cloudflare/cloudflared

# On Linux:
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Authenticate (if not already done)
cloudflared tunnel login

# Add DNS records (run on your Pi5 via SSH)
cloudflared tunnel route dns aa269442-1a8a-4485-8423-bbd64c36ff59 admin.darklock.net
cloudflared tunnel route dns aa269442-1a8a-4485-8423-bbd64c36ff59 platform.darklock.net
```

**SSH to Pi5 and run:**
```bash
ssh ubuntu@192.168.50.2
cloudflared tunnel route dns aa269442-1a8a-4485-8423-bbd64c36ff59 admin.darklock.net
cloudflared tunnel route dns aa269442-1a8a-4485-8423-bbd64c36ff59 platform.darklock.net
```

---

## 🧪 Testing Your Setup

### 1. Check Tunnel Status on Pi5

```bash
ssh ubuntu@192.168.50.2
sudo systemctl status cloudflared
```

Expected output: `Active: active (running)`

### 2. Check Platform Server Status

```bash
ssh ubuntu@192.168.50.2
sudo systemctl status darklock-platform
curl http://localhost:3002/admin
```

Expected output: Should return HTML or redirect to `/signin`

### 3. Test Public URLs (Wait 2-5 minutes for DNS propagation)

Open in your browser:
- **Main Dashboard:** https://darklock.net
- **Admin v4:** https://admin.darklock.net 🆕
- **Platform:** https://platform.darklock.net 🆕
- **XP Leaderboard:** https://xp.darklock.net

Login credentials for admin panel:
- **Email:** admin@darklock.net
- **Password:** admin123

---

## 🔒 Security Settings Recommended

After DNS is working, configure these security settings in Cloudflare:

### SSL/TLS Settings
1. Go to **SSL/TLS** → **Overview**
2. Set encryption mode: **Full** (or **Full (strict)** if you have valid certs)

### Firewall Rules (Optional)
1. Go to **Security** → **WAF**
2. Create a rule to block non-HTTPS traffic
3. Rate limit admin panel to prevent brute force

### Access Control (Optional - Recommended for Admin Panel)
1. Go to **Zero Trust** → **Access**
2. Create an Access policy for `admin.darklock.net`
3. Require email verification or 2FA for admin access

---

## 📊 Current Pi5 Services Status

```bash
# Check all services
ssh ubuntu@192.168.50.2 'sudo systemctl status darklock-platform discord-bot cloudflared --no-pager'

# View logs
ssh ubuntu@192.168.50.2 'sudo journalctl -u darklock-platform -f'
```

---

## 🆘 Troubleshooting

### DNS Not Resolving
```bash
# Check DNS propagation
nslookup admin.darklock.net
dig admin.darklock.net

# Should show CNAME pointing to cfargotunnel.com
```

### 502 Bad Gateway
```bash
# Check if platform is running
ssh ubuntu@192.168.50.2 'curl http://localhost:3002/admin'

# Restart if needed
ssh ubuntu@192.168.50.2 'sudo systemctl restart darklock-platform'
```

### Tunnel Not Connected
```bash
# Check tunnel status
ssh ubuntu@192.168.50.2 'sudo systemctl status cloudflared'

# View tunnel logs
ssh ubuntu@192.168.50.2 'sudo journalctl -u cloudflared -f'

# Restart tunnel
ssh ubuntu@192.168.50.2 'sudo systemctl restart cloudflared'
```

### CORS Errors
The Darklock platform already has CORS configured for:
- `https://darklock.net`
- `https://platform.darklock.net`
- `localhost:3002` (testing)

If you add new subdomains, update the CORS in `/home/ubuntu/discord-bot/.env`:
```bash
CORS_ORIGINS=https://darklock.net,https://platform.darklock.net,https://admin.darklock.net
```

Then restart: `sudo systemctl restart darklock-platform`

---

## 📝 Summary Checklist

- [x] ✅ Pi5 services running (darklock-platform on port 3002)
- [x] ✅ Cloudflare tunnel configured with new routes
- [ ] ⏳ Add DNS CNAME records in Cloudflare dashboard
- [ ] ⏳ Wait 2-5 minutes for DNS propagation
- [ ] ⏳ Test https://admin.darklock.net
- [ ] ⏳ Test https://platform.darklock.net
- [ ] ⏳ Login with admin credentials

---

## 🎉 After Setup

Once DNS records are added and propagated (2-5 minutes):

1. **Visit https://admin.darklock.net**
2. **Login:**
   - Email: `admin@darklock.net`
   - Password: `admin123`
3. **Change default password** in Security Settings tab
4. **Explore the 9 admin tabs:**
   - Overview (stats)
   - Announcements
   - Accounts (user management)
   - Roles & Access (RBAC)
   - App Updates
   - Bug Reports
   - System Logs (audit trail)
   - Security Settings
   - Platform Settings

---

## 📞 Quick Commands Reference

```bash
# SSH to Pi5
ssh ubuntu@192.168.50.2

# Check all services
sudo systemctl status darklock-platform discord-bot cloudflared

# Restart platform
sudo systemctl restart darklock-platform

# View platform logs
sudo journalctl -u darklock-platform -f

# Test locally
curl http://localhost:3002/admin
```

---

**Need Help?** Check the Pi5 logs or restart services if anything isn't working.

**Your tunnel ID:** `aa269442-1a8a-4485-8423-bbd64c36ff59`
