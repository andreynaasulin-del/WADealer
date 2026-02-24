# WA Dealer — WhatsApp Multi-Session Outreach

Multi-session WhatsApp outreach system built on `@whiskeysockets/baileys` with a Next.js 15 admin panel.

- Deep human behavior emulation (random delays 4–9 min, typing simulation 8–12 sec)
- Each phone number connects **only** through its own SOCKS5 proxy
- Spintax message randomization `{Привет|Здравствуйте|Хей}`
- Live logs via WebSocket
- One-click import of 990 profiles from Tahles database

---

## Quick Start

### 1. Run SQL migration

Open **Supabase Dashboard → SQL Editor** and run:

```
sql/001_wa_tables.sql
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your Supabase credentials (same as Tahles)
npm run dev
```

Backend starts on `http://localhost:3001`

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Frontend starts on `http://localhost:3000`

---

## Workflow: обработка 990 анкет Tahles

1. **Добавить сессию** → вводим номер телефона + SOCKS5 прокси (`ip:port:user:pass`)
2. **Сканировать QR** → открыть WhatsApp на телефоне → Linked Devices → сканировать
3. **Создать кампанию** → вставить шаблон с Spintax + выбрать задержку
4. **Импортировать лиды** → кнопка "Импорт из Tahles" — подтянет все контакты из `contacts` таблицы
5. **Нажать СТАРТ** → очередь обработает 990 лидов с эмуляцией живого человека

---

## Architecture

```
WhatsApp Dealer/
├── backend/                  # Node.js + Fastify + Baileys
│   └── src/
│       ├── index.js          # Fastify server + WebSocket
│       ├── orchestrator.js   # Multi-session manager
│       ├── session.js        # Baileys wrapper per phone
│       ├── queue.js          # Message queue + human delays
│       ├── spintax.js        # {option1|option2} parser
│       ├── db.js             # Supabase operations
│       └── routes/           # REST API
│           ├── sessions.js
│           ├── campaigns.js
│           ├── leads.js
│           └── stats.js
├── frontend/                 # Next.js 15 + Tailwind v4
│   └── src/
│       ├── app/page.tsx      # Main dashboard
│       ├── components/
│       │   ├── SessionManager.tsx
│       │   ├── CampaignController.tsx
│       │   ├── LiveLogs.tsx
│       │   └── StatsBar.tsx
│       └── hooks/useWS.ts    # WebSocket hook
└── sql/
    └── 001_wa_tables.sql     # DB migration
```

---

## Proxy format

```
ip:port:user:pass
185.162.10.5:1080:myuser:mypass
```

---

## Spintax format

```
{Привет|Здравствуйте|Шалом}! {Видел|Нашел|Просмотрел} вашу анкету на Tahles.
{Предлагаю|Хочу предложить|Есть предложение по} эксклюзивному размещению.
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | Список сессий |
| POST | `/api/sessions` | Добавить сессию |
| DELETE | `/api/sessions/:phone` | Удалить сессию |
| GET | `/api/sessions/:phone/qr` | Получить QR |
| GET | `/api/campaigns` | Список кампаний |
| POST | `/api/campaigns` | Создать кампанию |
| PUT | `/api/campaigns/:id/start` | Запустить |
| PUT | `/api/campaigns/:id/pause` | Пауза |
| PUT | `/api/campaigns/:id/stop` | Остановить |
| POST | `/api/leads/import` | Импорт из Tahles |
| GET | `/api/stats` | Статистика |
| WS | `/ws` | Live events |
