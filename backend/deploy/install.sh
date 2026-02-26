#!/usr/bin/env bash
# ============================================================
# WADealer Backend — VPS Setup Script (Ubuntu 22.04 / 24.04)
# Run as root: bash install.sh
# ============================================================
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║   WADealer Backend — VPS Installer       ║"
echo "╚══════════════════════════════════════════╝"

# ── 1. System updates ──────────────────────────────────────
echo "→ Updating system..."
apt update && apt upgrade -y
apt install -y curl git ufw

# ── 2. Node.js 20 LTS ─────────────────────────────────────
echo "→ Installing Node.js 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
echo "   Node: $(node -v)  npm: $(npm -v)"

# ── 3. PM2 — process manager ──────────────────────────────
echo "→ Installing PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ── 4. Clone project ──────────────────────────────────────
APP_DIR="/opt/wa-dealer"
if [ -d "$APP_DIR" ]; then
  echo "→ Updating existing repo..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "→ Cloning WADealer..."
  git clone https://github.com/andreynaasulin-del/WADealer.git "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 5. Install backend dependencies ───────────────────────
echo "→ Installing backend dependencies..."
cd "$APP_DIR/backend"
npm install --production

# ── 6. Create sessions directory ───────────────────────────
mkdir -p "$APP_DIR/backend/sessions"

# ── 7. Setup .env (if not exists) ─────────────────────────
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "→ Creating .env from template..."
  cat > "$APP_DIR/backend/.env" << 'ENVEOF'
PORT=3001
CORS_ORIGIN=https://wa-dealer.vercel.app

# Supabase
SUPABASE_URL=https://cmzrhkrexpvqmhyblvoi.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_KEY_HERE
SUPABASE_ANON_KEY=YOUR_KEY_HERE

# Sessions
SESSIONS_DIR=./sessions

# Froxy Mobile+ Proxy (Israel)
FROXY_HOST=185.162.130.86
FROXY_USER=YOUR_USER
FROXY_PASS=YOUR_PASS
FROXY_BASE_PORT=10000

# Telegram
TG_API_ID=12345
TG_API_HASH=your_api_hash_here

# Admin secret
ADMIN_SECRET=developerrealdealmoves2026yssrtopqwm2345

# OpenAI (GPT-4o-mini for AI Lead Detector)
OPENAI_API_KEY=YOUR_KEY_HERE
ENVEOF
  echo "   ⚠️  EDIT .env with real keys: nano $APP_DIR/backend/.env"
else
  echo "→ .env already exists, updating CORS_ORIGIN..."
  sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://wa-dealer.vercel.app|' "$APP_DIR/backend/.env"
fi

# ── 8. PM2 ecosystem config ──────────────────────────────
echo "→ Creating PM2 ecosystem..."
cat > "$APP_DIR/backend/ecosystem.config.cjs" << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'wa-dealer',
    cwd: '/opt/wa-dealer/backend',
    script: 'src/index.js',
    interpreter: 'node',
    node_args: '--experimental-specifier-resolution=node',
    env: {
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/wa-dealer-error.log',
    out_file: '/var/log/wa-dealer-out.log',
    merge_logs: true,
    time: true,
  }]
};
PM2EOF

# ── 9. Firewall ──────────────────────────────────────────
echo "→ Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 3001/tcp  # Backend API + WebSocket
ufw --force enable

# ── 10. Start with PM2 ──────────────────────────────────
echo "→ Starting WADealer backend..."
cd "$APP_DIR/backend"
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ WADealer Backend Installed!         ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  1. Edit .env:                           ║"
echo "║     nano /opt/wa-dealer/backend/.env     ║"
echo "║                                          ║"
echo "║  2. Restart after .env changes:          ║"
echo "║     pm2 restart wa-dealer                ║"
echo "║                                          ║"
echo "║  3. Check logs:                          ║"
echo "║     pm2 logs wa-dealer                   ║"
echo "║                                          ║"
echo "║  4. Backend URL:                         ║"
echo "║     http://YOUR_IP:3001                  ║"
echo "║                                          ║"
echo "║  5. Set in Vercel:                       ║"
echo "║     NEXT_PUBLIC_BACKEND_URL=             ║"
echo "║       http://YOUR_IP:3001                ║"
echo "║     NEXT_PUBLIC_BACKEND_WS_URL=          ║"
echo "║       ws://YOUR_IP:3001/ws               ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
