# Production Deployment Checklist for GuardianBot v1.0.0

## ✅ Pre-Deployment Checklist

### 1. Code Quality & Testing
- [x] All tests passing (100% - 54/54 tests)
- [x] No critical errors in code
- [x] Code review completed
- [x] Security audit passed
- [x] Load testing completed (if applicable)

### 2. Environment Configuration
- [ ] Production `.env` file configured
- [ ] `PRODUCTION_MODE=true` set
- [ ] `NODE_ENV=production` set
- [ ] All required environment variables present:
  - [ ] `DISCORD_TOKEN`
  - [ ] `CLIENT_ID`
  - [ ] `CLIENT_SECRET`
  - [ ] `REDIRECT_URI` (production URL)
  - [ ] `SESSION_SECRET` (strong random string)
  - [ ] `BACKUP_ENCRYPTION_KEY` (for encrypted backups)
- [ ] Database path configured correctly
- [ ] Log directory exists and writable

### 3. Dependencies & Build
- [ ] `npm install --production` run successfully
- [ ] All peer dependencies resolved
- [ ] No security vulnerabilities (`npm audit`)
- [ ] Node.js version compatible (v16+ required)

### 4. Database
- [ ] Database migrations applied (if any)
- [ ] Database backed up before deployment
- [ ] Database connection tested
- [ ] Guild configs table initialized
- [ ] Indexes created for performance

### 5. Security
- [ ] Session secret is strong and unique
- [ ] Encryption keys are secure
- [ ] No hard-coded credentials in code
- [ ] HTTPS enabled (for production)
- [ ] Rate limiting configured
- [ ] CORS configured properly
- [ ] Input sanitization active

### 6. Discord Configuration
- [ ] Bot token is valid
- [ ] OAuth2 redirect URI matches production URL
- [ ] Bot has all required permissions
- [ ] Bot is in test guild for verification
- [ ] Slash commands registered

### 7. Monitoring & Logging
- [ ] Logger configured for production
- [ ] Error logging to file enabled
- [ ] Health check endpoint tested (`/api/health`)
- [ ] Uptime monitoring configured (optional)
- [ ] Analytics tracking initialized

### 8. Backups
- [ ] Daily backup script tested
- [ ] Backup directory exists
- [ ] Encryption key set (if using encryption)
- [ ] Backup retention configured (14 days default)
- [ ] Cron job scheduled for daily backups

### 9. Performance
- [ ] Memory limits configured (if using PM2)
- [ ] CPU limits reasonable
- [ ] WebSocket connections tested
- [ ] Large guild handling tested (500+ channels/roles)

### 10. Documentation
- [x] README.md updated with deployment instructions
- [x] CHANGELOG.md created
- [x] RELEASE_REPORT.md generated
- [ ] API documentation accessible
- [ ] User guide available

---

## 🚀 Deployment Steps

### Step 1: Prepare Server
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y  # For Ubuntu/Debian

# Install Node.js v16+ (if not installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
npm install -g pm2
```

### Step 2: Deploy Code
```bash
# Clone repository (or upload files)
git clone https://github.com/anonymous-hidden/discord-security-bot.git
cd discord-security-bot

# Install dependencies (production only)
npm install --production

# Or install all dependencies including dev tools
npm install
```

### Step 3: Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit .env with production values
nano .env
```

**Required .env configuration:**
```env
DISCORD_TOKEN=your_production_bot_token
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REDIRECT_URI=https://yourdomain.com/auth/callback
SESSION_SECRET=generate_strong_random_string_here
PORT=3000
NODE_ENV=production
PRODUCTION_MODE=true
BACKUP_ENCRYPTION_KEY=generate_another_strong_key
```

### Step 4: Test Locally
```bash
# Run bot in foreground to verify
node src/bot.js

# Check for errors in console
# Verify bot connects to Discord
# Test dashboard at http://localhost:3000
# Ctrl+C to stop
```

### Step 5: Start with PM2
```bash
# Start bot with PM2
pm2 start src/bot.js --name guardianbot

# Save PM2 configuration
pm2 save

# Enable PM2 to start on boot
pm2 startup
# Follow the command it outputs

# Check status
pm2 status
pm2 logs guardianbot
```

### Step 6: Configure Firewall
```bash
# Allow port 3000 (dashboard)
sudo ufw allow 3000/tcp

# Allow SSH (if not already)
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

### Step 7: Setup Reverse Proxy (Optional but Recommended)
```nginx
# /etc/nginx/sites-available/guardianbot
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/guardianbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 8: Setup SSL (HTTPS)
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal is configured automatically
```

### Step 9: Configure Daily Backups
```bash
# Add to crontab
crontab -e

# Add this line (runs daily at 3 AM)
0 3 * * * cd /path/to/discord-security-bot && node scripts/daily-backup.js create >> /var/log/guardianbot-backup.log 2>&1
```

### Step 10: Verify Deployment
- [ ] Visit health check: `https://yourdomain.com/api/health`
- [ ] Login via Discord OAuth works
- [ ] Dashboard loads correctly
- [ ] Bot responds to commands in Discord
- [ ] Settings save properly
- [ ] WebSocket updates work
- [ ] Check PM2 logs: `pm2 logs guardianbot`

---

## 📊 Post-Deployment Monitoring

### Monitor Bot Health
```bash
# View real-time logs
pm2 logs guardianbot

# Check process status
pm2 status

# Monitor resources
pm2 monit

# Restart if needed
pm2 restart guardianbot
```

### Monitor Dashboard
```bash
# Check Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check bot application logs
cat logs/bot.log
```

### Health Checks
```bash
# Test health endpoint
curl https://yourdomain.com/api/health

# Expected response:
# {"success":true,"data":{"status":"online","uptime":1234,"database":"ok","websocket":"ok","version":"1.0.0"}}
```

---

## 🔧 Common Issues & Solutions

### Issue: Bot won't start
**Solution:**
```bash
# Check logs
pm2 logs guardianbot --lines 100

# Verify environment variables
cat .env

# Test database connection
node -e "const db = require('./src/database/database'); console.log('DB OK');"
```

### Issue: Dashboard shows 502 Bad Gateway
**Solution:**
```bash
# Check if bot is running
pm2 status

# Check port 3000 is listening
sudo netstat -tlnp | grep 3000

# Restart bot
pm2 restart guardianbot
```

### Issue: OAuth2 login fails
**Solution:**
- Verify `REDIRECT_URI` in `.env` matches Discord Developer Portal
- Check `CLIENT_ID` and `CLIENT_SECRET` are correct
- Ensure HTTPS is used for production

### Issue: High memory usage
**Solution:**
```bash
# Set memory limit with PM2
pm2 delete guardianbot
pm2 start src/bot.js --name guardianbot --max-memory-restart 500M

# Or edit ecosystem.config.js
```

---

## 🎯 Performance Tuning

### PM2 Ecosystem File
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'guardianbot',
    script: './src/bot.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PRODUCTION_MODE: 'true'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

Start with:
```bash
pm2 start ecosystem.config.js
```

---

## 📦 Rollback Plan

If deployment fails:

```bash
# Stop current version
pm2 stop guardianbot

# Restore database from backup
node scripts/daily-backup.js restore /path/to/backup/db-backup-2025-12-11.db.enc

# Revert code (if using git)
git checkout v0.9.0  # or previous stable version

# Restart bot
pm2 restart guardianbot

# Verify health
curl https://yourdomain.com/api/health
```

---

## ✅ Deployment Complete!

Once all steps are complete:
1. Monitor bot for first 24 hours
2. Check error logs regularly
3. Verify backups are running daily
4. Test all critical features
5. Gather user feedback

**Version**: 1.0.0  
**Deployed**: [DATE]  
**Status**: ✅ Production Ready
