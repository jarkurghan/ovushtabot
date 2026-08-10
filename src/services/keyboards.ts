import { InlineKeyboard, Keyboard } from "grammy";
import { t } from "../i18n";
import type { Lang } from "../utils/types";
import type { ContactSummary, DebtWithMeta } from "./debts";
import { escapeHtml, formatAmount, formatContactName, formatDate } from "../utils/format";
import { pageCallback } from "../utils/paginate";

export function mainReplyKeyboard(lang: Lang) {
    return new Keyboard()
        .text(t(lang, "btn_add"))
        .text(t(lang, "btn_list"))
        .row()
        .text(t(lang, "btn_people"))
        .text(t(lang, "btn_summary"))
        .row()
        .text(t(lang, "btn_settings"))
        .resized()
        .persistent();
}

export function cancelKeyboard(lang: Lang) {
    return new Keyboard().text(t(lang, "btn_cancel")).resized().oneTime();
}

export function repayAmountKeyboard(lang: Lang) {
    return new Keyboard()
        .text(t(lang, "btn_repay_all"))
        .row()
        .text(t(lang, "btn_cancel"))
        .resized()
        .oneTime();
}

export function cancelSkipKeyboard(lang: Lang) {
    return new Keyboard().text(t(lang, "btn_skip")).row().text(t(lang, "btn_cancel")).resized().oneTime();
}

export function dueDateKeyboard(lang: Lang) {
    return new Keyboard()
        .text(t(lang, "due_today"))
        .text(t(lang, "due_tomorrow"))
        .row()
        .text(t(lang, "due_in_3_days"))
        .text(t(lang, "due_in_1_week"))
        .row()
        .text(t(lang, "due_next_month_1st"))
        .row()
        .text(t(lang, "due_in_1_month"))
        .row()
        .text(t(lang, "btn_skip"))
        .row()
        .text(t(lang, "btn_cancel"))
        .resized()
        .oneTime();
}

export function languageKeyboard() {
    return new InlineKeyboard().text("O'zbek (lotin)", "lang_uz").row().text("Ўзбек (кирилл)", "lang_cyrl");
}

export function directionKeyboard(lang: Lang) {
    return new InlineKeyboard()
        .text(t(lang, "direction_borrowed"), "dir_borrowed")
        .row()
        .text(t(lang, "direction_lent"), "dir_lent")
        .row()
        .text(t(lang, "btn_cancel"), "cancel");
}

/** Sahifa navigatsiyasi: ‹ | 2/5 | › */
export function appendPageNav(
    kb: InlineKeyboard,
    lang: Lang,
    callbackPrefix: string,
    page: number,
    totalPages: number,
): InlineKeyboard {
    if (totalPages <= 1) return kb;
    const label = t(lang, "page_of", { page: page + 1, total: totalPages });
    if (page > 0) {
        kb.text("‹", pageCallback(callbackPrefix, page - 1));
    } else {
        kb.text("·", "noop");
    }
    kb.text(label, "noop");
    if (page < totalPages - 1) {
        kb.text("›", pageCallback(callbackPrefix, page + 1));
    } else {
        kb.text("·", "noop");
    }
    return kb.row();
}

export function contactPickerKeyboard(
    lang: Lang,
    contactsList: { id: number; name: string }[],
    page: number,
    totalPages: number,
) {
    const kb = new InlineKeyboard();
    for (const c of contactsList) {
        kb.text(formatContactName(c.name).slice(0, 60), `cpick_${c.id}`).row();
    }
    appendPageNav(kb, lang, "cpick", page, totalPages);
    kb.text(t(lang, "btn_cancel"), "cancel");
    return kb;
}

export function peopleListKeyboard(
    lang: Lang,
    contacts: ContactSummary[],
    page: number,
    totalPages: number,
) {
    const kb = new InlineKeyboard();
    for (const c of contacts) {
        const label = `${c.name}: 📥 ${formatAmount(c.borrowedBalance, lang)} / 📤 ${formatAmount(c.lentBalance, lang)}`;
        kb.text(label.slice(0, 60), `pdebts_${c.id}`).row();
    }
    appendPageNav(kb, lang, "people", page, totalPages);
    kb.text(t(lang, "btn_back"), "menu");
    return kb;
}

export function debtListKeyboard(
    lang: Lang,
    list: DebtWithMeta[],
    prefix: "debt" | "cdebt",
    page: number,
    totalPages: number,
) {
    const kb = new InlineKeyboard();
    for (const d of list) {
        const arrow = d.direction === "borrowed" ? "📥" : "📤";
        const amount = prefix === "cdebt" ? d.initial_amount : d.balance;
        const label = `${arrow} ${d.contact_name}: ${formatAmount(amount, lang)}`;
        kb.text(label.slice(0, 60), `debt_${d.id}`).row();
    }
    const navPrefix = prefix === "debt" ? "list_open" : "list_closed";
    appendPageNav(kb, lang, navPrefix, page, totalPages);
    if (prefix === "debt") {
        kb.text(t(lang, "view_closed"), "list_closed");
    } else {
        kb.text(t(lang, "btn_back"), "list_open");
    }
    return kb;
}

export function contactDebtsKeyboard(
    lang: Lang,
    list: DebtWithMeta[],
    contactId: number,
    status: "open" | "closed",
    page: number,
    totalPages: number,
    hideWhenZero = false,
    /** Faqat aktiv qarz yo'qida «ovushmayman» tugmasi */
    showHideWhenZero = false,
) {
    const kb = new InlineKeyboard();
    for (const d of list) {
        const arrow = d.direction === "borrowed" ? "📥" : "📤";
        const due = d.due_date ? ` · ${formatDate(d.due_date, lang)}` : "";
        const amount = status === "closed" ? d.initial_amount : d.balance;
        const label = `${arrow} ${formatAmount(amount, lang)}${due}`;
        kb.text(label.slice(0, 60), `debt_${d.id}`).row();
    }
    const navPrefix = status === "open" ? `pdebts_${contactId}` : `pclosed_${contactId}`;
    appendPageNav(kb, lang, navPrefix, page, totalPages);
    if (status === "open") {
        kb.text(t(lang, "view_closed"), `pclosed_${contactId}`).row();
    } else {
        kb.text(t(lang, "open_debts"), `pdebts_${contactId}`).row();
    }
    kb.text(t(lang, "edit_contact_name"), `rename_${contactId}`).row();
    if (showHideWhenZero) {
        const hideLabel = hideWhenZero
            ? t(lang, "hide_when_zero_on")
            : t(lang, "hide_when_zero_off");
        kb.text(hideLabel, `hidez_${contactId}`).row();
    }
    kb.text(t(lang, "btn_back"), "people");
    return kb;
}

export function summaryKeyboard(lang: Lang, page: number, totalPages: number) {
    const kb = new InlineKeyboard();
    appendPageNav(kb, lang, "summary", page, totalPages);
    kb.text(t(lang, "btn_back"), "menu");
    return kb;
}

export function debtDetailKeyboard(
    lang: Lang,
    debtId: number,
    canWrite: boolean,
    isOwner: boolean,
    backCallback = "list_open",
    canShare = true,
    hasDueDate = false,
) {
    const kb = new InlineKeyboard();
    if (canWrite) {
        kb.text(`↩️ ${t(lang, "repay")}`, `repay_${debtId}`).text(`➕ ${t(lang, "charge")}`, `charge_${debtId}`).row();
        kb.text(t(lang, hasDueDate ? "change_due" : "set_due"), `due_${debtId}`).row();
    }
    if (isOwner && canShare) {
        kb.text(t(lang, "share_debt"), `share_${debtId}`).row();
    }
    kb.text(t(lang, "btn_back"), backCallback);
    return kb;
}

export function settingsKeyboard(lang: Lang, user: { notify_enabled: boolean; notify_time: string; language: Lang }) {
    const notifyState = user.notify_enabled ? t(lang, "on") : t(lang, "off");

    return new InlineKeyboard()
        .text(`${t(lang, "settings_lang")}: ${user.language === "cyrl" ? "Кирилл" : "Lotin"}`, "settings_lang")
        .row()
        .text(`${t(lang, "settings_notify_time")}: ${user.notify_time}`, "settings_time")
        .row()
        .text(`${t(lang, "settings_notify")}: ${notifyState}`, "toggle_notify")
        .row()
        .text(t(lang, "btn_done"), "menu");
}

export function notifyTimeKeyboard(lang: Lang) {
    const kb = new InlineKeyboard();
    for (let h = 6; h <= 22; h++) {
        const hour = String(h).padStart(2, "0");
        kb.text(`${hour}:00`, `ntime_${hour}:00`);
        if ((h - 5) % 3 === 0) kb.row();
    }
    kb.row().text(t(lang, "btn_back"), "settings");
    return kb;
}

export function formatDebtCard(lang: Lang, debt: DebtWithMeta, itemsPreview?: string): string {
    const dir = debt.direction === "borrowed" ? t(lang, "direction_borrowed") : t(lang, "direction_lent");
    const lines = [
        `<b>${dir}</b>`,
        `👤 <b>${debt.contact_name}</b>`,
        `💰 ${t(lang, "balance")}: <b>${formatAmount(debt.balance, lang)}</b>`,
        `📅 ${t(lang, "due")}: ${formatDate(debt.due_date, lang)}`,
    ];
    if (itemsPreview) {
        lines.push(`\n<b>${t(lang, "items")}:</b>\n${itemsPreview}`);
    }
    return lines.join("\n");
}

export function formatItemsPreview(
    lang: Lang,
    items: { type: string; amount: number; created_at: Date; note?: string | null }[],
): string {
    if (!items.length) return "—";
    return items
        .slice(0, 8)
        .map((i) => {
            const sign = i.type === "charge" ? "+" : "−";
            const d = formatDate(i.created_at.toISOString().slice(0, 10), lang);
            const note = i.note?.trim() ? ` — ${escapeHtml(i.note.trim())}` : "";
            return `${sign}${formatAmount(i.amount, lang)} (${d})${note}`;
        })
        .join("\n");
}
