# Debt Bot

Telegram bot for tracking personal debts (borrowed / lent), partial repayments, due-date reminders, and linking a debt with the other party via invite link.

## Stack

- Bun + Hono (webhook only)
- grammY
- Drizzle ORM + PostgreSQL
- TypeScript

## Features

- Add debt (direction, counterparty, amount, optional note and due date)
- Merge with an existing open debt for the same person and direction (extra charge), or net against the opposite direction (repay)
- Debt items: charges and repayments; debt auto-closes when balance reaches 0; overpay opens a reverse-direction debt
- People list, open debts, archive, and text summary
- Share a single debt via invite link (`/start share_<token>`): creates a mirrored twin debt for the other user (full sync of items and due date)
- Contact name collision on share: if the Telegram first name is already used, a new contact is created with suffix `2`, `3`, …
- Due-date notifications at a configurable hour (default `09:00`, `Asia/Tashkent`); can be toggled in settings
- Languages: Uzbek Latin (default) and Cyrillic
- Multi-step writes run in DB transactions (create / repay / twin / accept share)

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

Health checks: `GET /` · `GET /health`

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Watch mode |
| `bun run start` | Production start |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Apply migrations |
| `bun run db:studio` | Drizzle Studio |

## Env

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `DATABASE_URL` | Postgres connection string |
| `WEBHOOK_URL` | Public HTTPS base URL (webhook is set to `{WEBHOOK_URL}/bot`) |
| `WEBHOOK_SECRET` | Telegram webhook secret token |
| `PORT` | HTTP port (default `4040`) |
| `ADMIN_CHAT_ID` | Optional admin notifications (new users, status) |
| `LOG_CHAT_ID` | Optional error / activity logs |
