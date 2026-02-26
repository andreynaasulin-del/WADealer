#!/usr/bin/env bash
# Quick update script — run after pushing new code
# Usage: bash /opt/wa-dealer/backend/deploy/update.sh
set -euo pipefail

cd /opt/wa-dealer
echo "→ Pulling latest code..."
git pull origin main

echo "→ Installing dependencies..."
cd backend
npm install --production

echo "→ Restarting PM2..."
pm2 restart wa-dealer

echo "→ Status:"
pm2 status wa-dealer
echo "✅ Updated!"
