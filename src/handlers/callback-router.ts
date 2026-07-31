import type { CTX } from "../utils/types";
import { sendErrorLog } from "../services/log";
import {
    handleTextMessage,
    onActAs,
    onChargeStart,
    onCloseDebt,
    onDirection,
    onDueStart,
    onNotifyTimeMenu,
    onNotifyTimeSet,
    onRepayStart,
    onRevokeShare,
    onShareAllNew,
    onShareStart,
    showContactDebts,
    showDebtDetail,
    showDebtList,
    showPeopleList,
    showSharesSettings,
    startAddDebt,
} from "./action-debts";
import {
    onSelectLang,
    onSettingsLang,
    onToggleNotify,
    showMainMenu,
    showSettings,
} from "./action-settings";

export async function registerCallbackRouter(ctx: CTX) {
    try {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        if (data === "cancel") {
            await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.deleteMessage().catch(() => undefined);
            await showMainMenu(ctx);
            return;
        }

        if (data === "menu") {
            await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.deleteMessage().catch(() => undefined);
            await showMainMenu(ctx);
            return;
        }

        if (data === "lang_uz" || data === "lang_cyrl") {
            await onSelectLang(ctx);
            return;
        }

        if (data === "dir_borrowed" || data === "dir_lent") {
            await onDirection(ctx);
            return;
        }

        if (data === "actas_self") {
            await onActAs(ctx, "self");
            return;
        }

        if (data.startsWith("actas_")) {
            await onActAs(ctx, Number(data.slice("actas_".length)));
            return;
        }

        if (data === "list_open") {
            await showDebtList(ctx, "open");
            return;
        }

        if (data === "list_closed") {
            await showDebtList(ctx, "closed");
            return;
        }

        if (data === "people") {
            await showPeopleList(ctx);
            return;
        }

        if (data.startsWith("pdebts_")) {
            await showContactDebts(ctx, Number(data.slice("pdebts_".length)), "open");
            return;
        }

        if (data.startsWith("pclosed_")) {
            await showContactDebts(ctx, Number(data.slice("pclosed_".length)), "closed");
            return;
        }

        if (data === "settings") {
            await showSettings(ctx);
            return;
        }

        if (data === "settings_lang") {
            await onSettingsLang(ctx);
            return;
        }

        if (data === "settings_time") {
            await onNotifyTimeMenu(ctx);
            return;
        }

        if (data === "toggle_borrow") {
            await onToggleNotify(ctx, "borrow");
            return;
        }

        if (data === "toggle_lend") {
            await onToggleNotify(ctx, "lend");
            return;
        }

        if (data === "settings_shares") {
            await showSharesSettings(ctx);
            return;
        }

        if (data === "share_all_new") {
            await onShareAllNew(ctx);
            return;
        }

        if (data.startsWith("ntime_")) {
            await onNotifyTimeSet(ctx, data.slice("ntime_".length));
            return;
        }

        if (data.startsWith("debt_")) {
            await showDebtDetail(ctx, Number(data.slice(5)));
            return;
        }

        if (data.startsWith("cdebt_")) {
            await showDebtDetail(ctx, Number(data.slice(6)));
            return;
        }

        if (data.startsWith("sdebt_")) {
            await showDebtDetail(ctx, Number(data.slice(6)));
            return;
        }

        if (data.startsWith("repay_")) {
            await onRepayStart(ctx, Number(data.slice(6)));
            return;
        }

        if (data.startsWith("charge_")) {
            await onChargeStart(ctx, Number(data.slice(7)));
            return;
        }

        if (data.startsWith("due_")) {
            await onDueStart(ctx, Number(data.slice(4)));
            return;
        }

        if (data.startsWith("close_")) {
            await onCloseDebt(ctx, Number(data.slice(6)));
            return;
        }

        if (data.startsWith("share_")) {
            await onShareStart(ctx, Number(data.slice(6)));
            return;
        }

        if (data.startsWith("revoke_")) {
            await onRevokeShare(ctx, Number(data.slice(7)));
            return;
        }

        if (data === "add_debt") {
            await startAddDebt(ctx);
            return;
        }
    } catch (error) {
        await sendErrorLog({ event: "callback router", error, ctx });
    }
}

export { handleTextMessage };
