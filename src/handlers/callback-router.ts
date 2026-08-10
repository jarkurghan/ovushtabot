import type { CTX } from "../utils/types";
import { sendErrorLog } from "../services/log";
import {
    handleTextMessage,
    onChargeStart,
    onContactPick,
    onDirection,
    onToggleHideWhenZero,
    onDueStart,
    onNotifyTimeMenu,
    onNotifyTimeSet,
    onRenameContactStart,
    onRepayStart,
    onShareStart,
    showContactDebts,
    showContactPicker,
    showDebtDetail,
    showDebtList,
    showDebtSummary,
    showPeopleList,
    startAddDebt,
} from "./action-debts";
import {
    onSelectLang,
    onSettingsLang,
    onToggleNotify,
    showMainMenu,
    showSettings,
} from "./action-settings";
import { parsePageCallback } from "../utils/paginate";

export async function registerCallbackRouter(ctx: CTX) {
    try {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        if (data === "noop") {
            await ctx.answerCallbackQuery().catch(() => undefined);
            return;
        }

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

        if (data === "list_open" || data.startsWith("list_open_p")) {
            const page = data === "list_open" ? 0 : (parsePageCallback(data)?.page ?? 0);
            await showDebtList(ctx, "open", page);
            return;
        }

        if (data === "list_closed" || data.startsWith("list_closed_p")) {
            const page = data === "list_closed" ? 0 : (parsePageCallback(data)?.page ?? 0);
            await showDebtList(ctx, "closed", page);
            return;
        }

        if (data === "people" || data.startsWith("people_p")) {
            const page = data === "people" ? 0 : (parsePageCallback(data)?.page ?? 0);
            await showPeopleList(ctx, page);
            return;
        }

        if (data === "summary" || data.startsWith("summary_p")) {
            const page = data === "summary" ? 0 : (parsePageCallback(data)?.page ?? 0);
            await showDebtSummary(ctx, page);
            return;
        }

        if (data === "cpick" || data.startsWith("cpick_p")) {
            const page = data === "cpick" ? 0 : (parsePageCallback(data)?.page ?? 0);
            await showContactPicker(ctx, page);
            return;
        }

        if (data.startsWith("cpick_")) {
            const id = Number(data.slice("cpick_".length));
            if (Number.isFinite(id)) {
                await onContactPick(ctx, id);
                return;
            }
        }

        // pdebts_{id} | pdebts_{id}_p{N}
        if (data.startsWith("pdebts_")) {
            const paged = parsePageCallback(data);
            if (paged?.base.startsWith("pdebts_")) {
                const id = Number(paged.base.slice("pdebts_".length));
                if (Number.isFinite(id)) {
                    await showContactDebts(ctx, id, "open", paged.page);
                    return;
                }
            }
            const id = Number(data.slice("pdebts_".length));
            if (Number.isFinite(id)) {
                await showContactDebts(ctx, id, "open", 0);
                return;
            }
        }

        if (data.startsWith("pclosed_")) {
            const paged = parsePageCallback(data);
            if (paged?.base.startsWith("pclosed_")) {
                const id = Number(paged.base.slice("pclosed_".length));
                if (Number.isFinite(id)) {
                    await showContactDebts(ctx, id, "closed", paged.page);
                    return;
                }
            }
            const id = Number(data.slice("pclosed_".length));
            if (Number.isFinite(id)) {
                await showContactDebts(ctx, id, "closed", 0);
                return;
            }
        }

        if (data.startsWith("hidez_")) {
            await onToggleHideWhenZero(ctx, Number(data.slice("hidez_".length)));
            return;
        }

        if (data.startsWith("rename_")) {
            await onRenameContactStart(ctx, Number(data.slice("rename_".length)));
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

        if (data === "toggle_notify") {
            await onToggleNotify(ctx);
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

        if (data.startsWith("share_")) {
            await onShareStart(ctx, Number(data.slice(6)));
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
