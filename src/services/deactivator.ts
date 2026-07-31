import { eq } from "drizzle-orm";
import type { Context } from "grammy";
import { users } from "../db/schema";
import { db } from "../db";
import { sendAdmin, sendErrorLog, sendLog } from "./log";
import { userLink } from "./save-user";
import type { Status } from "../utils/types";

export async function changeStatus(ctx: Context, status: Status): Promise<void> {
    const tg_id = ctx.from?.id;
    if (!tg_id) return;

    const link = userLink({
        tg_id,
        first_name: ctx.from?.first_name || "",
        last_name: ctx.from?.last_name || "",
        username: ctx.from?.username || "",
    });

    try {
        const [updated] = await db.update(users).set({ status }).where(eq(users.tg_id, String(tg_id))).returning();

        if (!updated) {
            await sendLog(
                `❗️ <b>Xato:</b>\n\n🔦 Status o'zgartirilmadi (topilmadi)\n🆔 <code>${tg_id}</code>\n👤 ${link}`,
            );
        } else {
            await sendAdmin(
                `♻️ Status: ${status}\n👤 ${link}\n🆔 <code>${tg_id}</code>\n🤖 debt-bot`,
            );
        }
    } catch (error) {
        await sendErrorLog({ event: "Status o'zgartirish", error, ctx });
    }
}
