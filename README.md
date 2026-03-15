# Weibo Account Smart Manager

A web + server system for:

- Content management: hourly draft generation (08:00-24:00) with 1-6 images, plus pre-slot approval reminders.
- Account management: Weibo OAuth login and profile viewing.
- Data management: persist post and account metrics in SQLite with backup files.

## Stack

- Server: Node.js + Express + node-cron
- Database: SQLite (`data/weibo_manager.db`)
- Frontend: static dashboard (`public/index.html`)

## Project Structure

```txt
.
├─ public/                 # Web dashboard
├─ src/
│  ├─ routes/              # API routes
│  ├─ services/            # Domain services (LLM, Weibo, stats, backup)
│  ├─ app.js               # Express app
│  ├─ config.js            # Environment config
│  ├─ db.js                # SQLite bootstrap + schema
│  ├─ index.js             # Entry point
│  ├─ scheduler.js         # Cron jobs
│  └─ time.js
├─ data/                   # SQLite file
├─ backups/                # Backup files
└─ .env.example
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Fill `.env` values:

- Required for Weibo login:
  - `WEIBO_APP_KEY`
  - `WEIBO_APP_SECRET`
  - `WEIBO_REDIRECT_URI` (must match your Weibo app config)
- Optional for LLM content/images:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`
  - `OPENAI_TEXT_MODEL`
  - `OPENAI_IMAGE_MODEL`

4. Start:

```bash
npm run dev
```

Open: `http://localhost:3000`

## Core Flows

## 1) Content Management

- Generation cron: `50 7-23 * * *` (for next publish slot 08:00-24:00).
- Reminder cron: `55 7-23 * * *` (approval reminder before slot).
- Draft status: `pending -> approved/rejected -> sent`.
- Manual trigger API: `POST /api/content/generate-next`.

## 2) Account Management

- Login: `GET /api/auth/weibo/login`
- Callback: `GET /api/auth/weibo/callback`
- Current account: `GET /api/auth/me`
- Refresh profile: `POST /api/auth/sync`

## 3) Data Management

- Sync stats: `POST /api/stats/sync`
- Query overview: `GET /api/stats/overview`
- Query follower history: `GET /api/stats/history?limit=100`
- Auto backup cron: `30 0 * * *`
- Manual backup: `POST /api/system/backup`

## Long-term Evolution Notes

- Start as a modular monolith; split services into workers when throughput grows.
- Add queue (BullMQ/RabbitMQ) for generation and sync retries.
- Add RBAC + session/JWT if multi-user collaboration is required.
- Add object storage for generated images and immutable audit logs.
- Add BI dashboards for trend analysis (weekly growth, best posting slots).
