import { GrammyError } from "grammy";
import type { Context } from "grammy";
import { bot } from "../bot";
import { ADMIN_CHAT, LOG_CHAT } from "../utils/constants";
import type { ErrorLogOptions, LogOptions } from "../utils/types";
import { groupLink, userLink } from "./save-user";

export const sendLog = async (message: string, options?: LogOptions): Promise<void> => {
    if (!LOG_CHAT) {
        console.log("[log]", message);
        return;
    }
    try {
        const { parse_mode = "HTML", reply_to_message_id } = options || {};
        await bot.api.sendMessage(LOG_CHAT, message, {
            parse_mode,
            ...(reply_to_message_id ? { reply_parameters: { message_id: reply_to_message_id } } : {}),
        });
    } catch (error) {
        console.error("System error:", error);
    }
};

export const sendErrorLog = async (options: ErrorLogOptions): Promise<void> => {
    try {
        const { ctx, event, error } = options;
        const from = ctx?.from;
        const chat = ctx?.chat;

        let logMessage = "";
        if (error instanceof GrammyError) {
            logMessage = error.description || error.message;
        } else if (error instanceof Error) {
            logMessage = error.stack || error.message;
        } else {
            logMessage = String(error);
        }

        const lines: string[] = [`💣 <b>Xatolik:</b>\n`, `📍 Qayerda: ${event}`, `🔦 Tafsilot: ${logMessage}`];

        if (chat && (chat.type === "group" || chat.type === "supergroup" || chat.type === "channel")) {
            const kind = chat.type === "channel" ? "Kanal" : chat.type === "group" ? "Guruh" : "Superguruh";
            lines.push(`💬 Chat turi: ${kind}`);
            lines.push(`🆔 Chat ID: <code>${chat.id}</code>`);
            lines.push(`📢 Chat: ${groupLink(chat)}`);
        } else if (chat && chat.type === "private") {
            lines.push(`💬 Chat turi: Shaxsiy`);
        }

        if (from) {
            const tg_id = String(from.id);
            const userlink = userLink({
                tg_id,
                first_name: from.first_name,
                last_name: from.last_name,
                username: from.username,
            });
            lines.push(`🆔 User ID: <code>${tg_id}</code>`);
            lines.push(`👤 User: ${userlink}`);
        }

        await sendLog(lines.join("\n"), { parse_mode: "HTML" });
    } catch (error) {
        console.error("System error:", error);
    }
};

export const sendAdmin = async (message: string, options?: LogOptions): Promise<void> => {
    if (!ADMIN_CHAT) {
        console.log("[admin]", message);
        return;
    }
    try {
        const { parse_mode = "HTML", reply_to_message_id } = options || {};
        await bot.api.sendMessage(ADMIN_CHAT, message, {
            parse_mode,
            ...(reply_to_message_id ? { reply_parameters: { message_id: reply_to_message_id } } : {}),
        });
    } catch (error) {
        await sendErrorLog({ event: "Adminga xabar yuborishda", error });
    }
};

export async function safeReply(ctx: Context, text: string, extra?: Parameters<Context["reply"]>[1]) {
    try {
        return await ctx.reply(text, extra);
    } catch (error) {
        await sendErrorLog({ event: "safeReply", error, ctx });
        return null;
    }
}
