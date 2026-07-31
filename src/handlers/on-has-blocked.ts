import type { Context, Filter } from "grammy";
import { saveUser } from "../services/save-user";
import { changeStatus } from "../services/deactivator";
import { sendErrorLog } from "../services/log";
import { t } from "../i18n";

export async function onHasBlocked(ctx: Filter<Context, "my_chat_member">) {
    try {
        if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
            await ctx.reply(t("uz", "only_private"));
            return;
        }

        await saveUser(ctx);

        if (ctx.myChatMember.new_chat_member.status === "kicked") {
            await changeStatus(ctx, "has_blocked");
        } else if (ctx.myChatMember.new_chat_member.status === "member") {
            await changeStatus(ctx, "active");
        }
    } catch (error) {
        await sendErrorLog({ event: "Foydalanuvchi bloklanganda", error, ctx });
    }
}
