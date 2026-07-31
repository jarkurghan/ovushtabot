import type { CTX, Lang } from "../utils/types";
import { t } from "../i18n";
import { saveUser } from "../services/save-user";
import { languageKeyboard, mainReplyKeyboard, settingsKeyboard } from "../services/keyboards";
import { sendErrorLog } from "../services/log";
import { clearSession } from "../services/session";

export async function showMainMenu(ctx: CTX) {
    const [user] = await saveUser(ctx);
    if (!user) return;
    clearSession(ctx.from!.id);
    await ctx.reply(t(user.language, "main_menu"), { reply_markup: mainReplyKeyboard(user.language) });
}

export async function showSettings(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const text = [
            t(user.language, "settings_title"),
            "",
            `${t(user.language, "settings_lang")}: ${user.language === "cyrl" ? "Кирилл" : "Lotin"}`,
            `${t(user.language, "settings_notify_time")}: ${user.notify_time}`,
            `${t(user.language, "settings_notify_borrow")}: ${user.notify_borrow ? t(user.language, "on") : t(user.language, "off")}`,
            `${t(user.language, "settings_notify_lend")}: ${user.notify_lend ? t(user.language, "on") : t(user.language, "off")}`,
        ].join("\n");

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.editMessageText(text, { reply_markup: settingsKeyboard(user.language, user) }).catch(async () => {
                await ctx.reply(text, { reply_markup: settingsKeyboard(user.language, user) });
            });
        } else {
            await ctx.reply(text, { reply_markup: settingsKeyboard(user.language, user) });
        }
    } catch (error) {
        await sendErrorLog({ event: "Sozlamalar", error, ctx });
    }
}

export async function onSettingsLang(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(t(user.language, "select_lang"), { reply_markup: languageKeyboard() });
    } catch (error) {
        await sendErrorLog({ event: "Til sozlamasi", error, ctx });
    }
}

export async function onSelectLang(ctx: CTX) {
    try {
        const data = ctx.callbackQuery?.data || "";
        const lang = (data === "lang_cyrl" ? "cyrl" : "uz") as Lang;
        const [user] = await saveUser(ctx, { language: lang, status: "active" });
        if (!user) return;

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);
        await ctx.reply(`${t(lang, "lang_set")}\n\n${t(lang, "welcome")}`, {
            reply_markup: mainReplyKeyboard(lang),
        });
    } catch (error) {
        await sendErrorLog({ event: "Til tanlash", error, ctx });
    }
}

export async function onToggleNotify(ctx: CTX, kind: "borrow" | "lend") {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const patch =
            kind === "borrow"
                ? { notify_borrow: !user.notify_borrow }
                : { notify_lend: !user.notify_lend };

        await saveUser(ctx, patch);
        await showSettings(ctx);
    } catch (error) {
        await sendErrorLog({ event: "Notify toggle", error, ctx });
    }
}
