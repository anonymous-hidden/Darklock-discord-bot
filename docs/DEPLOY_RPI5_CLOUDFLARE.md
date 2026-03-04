# Deploy DarkLock on Raspberry Pi 5 + Cloudflare (darklock.net)

This guide sets up the app on Raspberry Pi 5 (64‑bit Debian/Raspberry Pi OS), runs it with systemd, and exposes the web dashboard through Cloudflare using an Nginx reverse proxy.

---

## 1) Prepare the Pi

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx
```

### Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

---

## 2) Upload the project

Option A: Git clone (recommended)

```bash
cd ~
git clone <YOUR_REPO_URL> darklock
cd darklock
```

Option B: SCP from your computer

```bash
scp -r "/path/to/discord bot" pi@192.168.50.150:/home/pi/darklock
cd /home/pi/darklock
```

---

## 3) Install dependencies

```bash
cd /home/pi/darklock
npm install
```

---

## 4) Configure environment

```bash
cp .env.example .env
nano .env
```

Minimum required settings:

- `BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `JWT_SECRET`
- `ADMIN_PASSWORD`
- `INTERNAL_API_KEY`
- `WEB_HOST=127.0.0.1`
- `WEB_PORT=3001`
- `DARKLOCK_PORT=3002`
- `BASE_URL=https://darklock.net`
- `DASHBOARD_ORIGIN=https://darklock.net`
- `DISCORD_REDIRECT_URI=https://darklock.net/auth/discord/callback`

> Keep `WEB_HOST` on localhost since Nginx will proxy.

---

## 5) Initialize database (if needed)

```bash
npm run db:init
```

---

## 6) Create a systemd service

Create service:

```bash
sudo nano /etc/systemd/system/darklock.service
```

Paste:

```ini
[Unit]
Description=DarkLock Bot
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/darklock
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable darklock
sudo systemctl start darklock
sudo systemctl status darklock --no-pager
```

---

## 7) Configure Nginx reverse proxy

Create site config:

```bash
sudo nano /etc/nginx/sites-available/darklock
```

Paste:

```nginx
server {
    listen 80;
    server_name darklock.net www.darklock.net;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/darklock /etc/nginx/sites-enabled/darklock
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8) Cloudflare DNS + SSL (Public IP)

1. Ensure your router forwards **TCP 80 and 443** to **192.168.50.150**.
2. In Cloudflare DNS, create an **A record**:
   - Name: `darklock.net`
    - Target: your **public IP** (home ISP)
   - Proxy: **Proxied** (orange cloud)

3. Optional: add `www` CNAME → `darklock.net` (proxied).

4. In Cloudflare SSL/TLS:
   - **Full (strict)** recommended
   - Create an **Origin Certificate** and install it on the Pi (recommended) OR
   - Use **Full** temporarily if you haven’t installed the origin cert yet.

### Origin certificate (recommended)

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/origin.pem
sudo nano /etc/ssl/cloudflare/origin.key
```

Update Nginx server block to listen on 443:

```nginx
server {
    listen 443 ssl;
    server_name darklock.net www.darklock.net;

    ssl_certificate /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9) Cloudflare Tunnel (No public IP / CGNAT)

If you do **not** have a public IP, use a Cloudflare Tunnel instead of port forwarding.

### Install cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### Authenticate and create tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create darklock
```

### Create config

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Paste:

```yaml
tunnel: darklock
credentials-file: /etc/cloudflared/darklock.json

ingress:
    - hostname: darklock.net
        service: http://127.0.0.1:3001
    - hostname: www.darklock.net
        service: http://127.0.0.1:3001
    - service: http_status:404
```

Copy credentials file path shown by `cloudflared tunnel create` into `/etc/cloudflared/darklock.json`:

```bash
sudo cp /home/pi/.cloudflared/*.json /etc/cloudflared/darklock.json
sudo chown root:root /etc/cloudflared/darklock.json
sudo chmod 600 /etc/cloudflared/darklock.json
```

### Route DNS

```bash
cloudflared tunnel route dns darklock darklock.net
cloudflared tunnel route dns darklock www.darklock.net
```

### Run as a service

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared --no-pager
```

## 10) Firewall (optional)

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

---

## 11) Verify

```bash
curl -I http://127.0.0.1:3001
curl -I http://darklock.net
```

---

## 12) Updates

```bash
cd /home/pi/darklock
git pull
npm install
sudo systemctl restart darklock
```

---

## Notes

- If you are behind CGNAT or don’t have a public IP, use the Cloudflare Tunnel section above.
- If WebSocket issues occur, ensure the proxy headers in Nginx are present.
- Dashboard login redirect must match `DISCORD_REDIRECT_URI` exactly.
