import type { CommandContext, Context } from "grammy";
import { t } from "../i18n";
import { findUtm, getStartPayload, objPayload } from "../services/start-payload";
import { getUserById, saveUser } from "../services/save-user";
import { acceptShareInvite, getShareByInviteToken } from "../services/debts";
import { mainReplyKeyboard } from "../services/keyboards";
import { clearSession } from "../services/session";
import { sendErrorLog } from "../services/log";
import type { SaveUserData } from "../utils/types";

export async function registerStartCommand(ctx: CommandContext<Context>) {
    try {
        if (ctx.chat.type !== "private") {
            await ctx.reply(t("uz", "only_private"));
            return;
        }

        const payload = getStartPayload(ctx);
        const payloadObj = objPayload(payload);

        const saveData: SaveUserData = { status: "active", utm: findUtm(payloadObj) };

        if (payloadObj.share) {
            saveData.utm = "Ikkinchi tomon orqali";
            const share = await getShareByInviteToken(payloadObj.share);
            if (share?.granter_id) {
                const granter = await getUserById(share.granter_id);
                if (granter) {
                    saveData.referredBy = {
                        tg_id: granter.tg_id,
                        first_name: granter.first_name,
                        last_name: granter.last_name,
                        username: granter.username,
                    };
                }
            }
        }

        const [user] = await saveUser(ctx, saveData);
        if (!user) return;

        clearSession(ctx.from!.id);

        if (payloadObj.share) {
            const accepted = await acceptShareInvite(payloadObj.share, user.id);
            if (accepted) {
                await ctx.reply(t(user.language, "share_accepted_debt"), {
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
