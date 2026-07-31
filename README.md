# Debt Bot

Telegram bot for tracking debts (borrowed/lent), partial repayments, due-date reminders, and sharing access with another Telegram account.

## Stack

- Bun + Hono (webhook only)
- grammY
- Drizzle ORM + PostgreSQL
- TypeScript

## Features

- Add debt (amount + counterparty + optional due date)
- Debt items: extra charges and repayments (auto-close when balance hits 0)
- Share debt / contact / all debts with view or write access via invite link
- Due-date notifications at configurable time (default 09:00, Asia/Tashkent)
- Toggle borrow/lend notifications in settings
- Languages: Uzbek Latin (default) and Cyrillic

## Setup

```bash
cp .env.example .env
# fill BOT_TOKEN, DATABASE_URL, WEBHOOK_URL, WEBHOOK_SECRET, PORT

bun install
bun run db:generate
bun run db:migrate
bun run dev
```

Webhook endpoint: `POST {WEBHOOK_URL}/bot`

## Env

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | Postgres connection string |
| `WEBHOOK_URL` | Public HTTPS base URL |
| `WEBHOOK_SECRET` | Telegram webhook secret token |
| `PORT` | HTTP port (default 4040) |
| `ADMIN_CHAT_ID` | Optional admin notifications |
| `LOG_CHAT_ID` | Optional error logs |
