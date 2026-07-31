import { Hono } from "hono";
import { logger } from "hono/logger";
import { bot, handleUpdate } from "./bot";
import { PORT, WEBHOOK_SECRET, WEBHOOK_URL } from "./utils/constants";
import { startNotificationScheduler } from "./scheduler/notifications";

const app = new Hono();

app.use("*", logger());

app.get("/", (c) => c.text("debt-bot ok"));
app.get("/health", (c) => c.json({ ok: true }));
app.post("/bot", (c) => handleUpdate(c));

async function setupWebhook() {
    if (!WEBHOOK_URL) {
        console.warn("WEBHOOK_URL yo'q — webhook o'rnatilmadi");
        return;
    }

    const url = `${WEBHOOK_URL.replace(/\/$/, "")}/bot`;
    await bot.api.setWebhook(url, {
        secret_token: WEBHOOK_SECRET || undefined,
        drop_pending_updates: false,
        allowed_updates: ["message", "callback_query", "my_chat_member"],
    });
    console.log(`Webhook set: ${url}`);
}

await setupWebhook();
startNotificationScheduler();

export default { port: PORT, fetch: app.fetch };
console.log(`debt-bot listening on :${PORT}`);
