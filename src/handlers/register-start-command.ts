import type { CommandContext, Context } from "grammy";
import { t } from "../i18n";
import { findUtm, getStartPayload, objPayload } from "../services/start-payload";
import { saveUser } from "../services/save-user";
import { acceptShareInvite } from "../services/debts";
import { mainReplyKeyboard } from "../services/keyboards";
import { clearSession } from "../services/session";
import { sendErrorLog } from "../services/log";

export async function registerStartCommand(ctx: CommandContext<Context>) {
    try {
        if (ctx.chat.type !== "private") {
            await ctx.reply(t("uz", "only_private"));
            return;
        }

        const payload = getStartPayload(ctx);
        const payloadObj = objPayload(payload);
        const utm = findUtm(payloadObj);

        const [user] = await saveUser(ctx, { utm, status: "active" });
        if (!user) return;

        clearSession(ctx.from!.id);

        if (payloadObj.share) {
            const accepted = await acceptShareInvite(payloadObj.share, user.id);
            if (accepted) {
                const key = accepted.scope === "all" ? "share_accepted_account" : "share_accepted_debt";
                await ctx.reply(t(user.language, key), {
                    reply_markup: mainReplyKeyboard(user.language),
                });
            } else {
                await ctx.reply(t(user.language, "share_invalid"), {
                    reply_markup: mainReplyKeyboard(user.language),
                });
            }
            return;
        }

        await ctx.reply(`${t(user.language, "welcome")}\n\n${t(user.language, "main_menu")}`, {
            reply_markup: mainReplyKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "Start bosganda", error, ctx });
    }
}
