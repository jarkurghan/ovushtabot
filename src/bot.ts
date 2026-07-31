import { Bot, webhookCallback } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { BOT_TOKEN, WEBHOOK_SECRET } from "./utils/constants";
import { registerStartCommand } from "./handlers/register-start-command";
import { registerErrorHandler } from "./handlers/register-error-handler";
import { registerCallbackRouter } from "./handlers/callback-router";
import { handleTextMessage } from "./handlers/callback-router";
import { onHasBlocked } from "./handlers/on-has-blocked";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN topilmadi!");

export const bot = new Bot(BOT_TOKEN);

bot.api.config.use(autoRetry());

bot.command("start", registerStartCommand);
bot.on("callback_query:data", registerCallbackRouter);
bot.on("message:text", handleTextMessage);
bot.on("my_chat_member", onHasBlocked);
bot.catch(registerErrorHandler);

export const handleUpdate = webhookCallback(bot, "hono", { secretToken: WEBHOOK_SECRET || undefined });
