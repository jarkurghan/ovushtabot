import { InlineKeyboard, Keyboard } from "grammy";
import { t } from "../i18n";
import type { Lang } from "../utils/types";
import type { DebtWithMeta } from "./debts";
import { formatAmount, formatDate } from "../utils/format";

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

export function contactPickerKeyboard(lang: Lang, contactsList: { id: number; name: string }[]) {
    const kb = new Keyboard();
    for (let i = 0; i < contactsList.length; i++) {
        kb.text(contactsList[i].name.slice(0, 64));
        if (i % 2 === 1 || i === contactsList.length - 1) kb.row();
    }
    kb.text(t(lang, "contact_new")).row();
    kb.text(t(lang, "btn_cancel"));
    return kb.resized().oneTime();
}

/** Tanishlar ro'yxati (browse) — custom keyboard */
export function peopleBrowseKeyboard(lang: Lang, contactsList: { name: string }[]) {
    const kb = new Keyboard();
    for (let i = 0; i < contactsList.length; i++) {
        kb.text(contactsList[i].name.slice(0, 64));
        if (i % 2 === 1 || i === contactsList.length - 1) kb.row();
    }
    kb.text(t(lang, "btn_back"));
    return kb.resized().oneTime();
}

export function debtListKeyboard(lang: Lang, list: DebtWithMeta[], prefix = "debt") {
    const kb = new InlineKeyboard();
    for (const d of list) {
        const arrow = d.direction === "borrowed" ? "📥" : "📤";
        const amount = prefix === "cdebt" ? d.initial_amount : d.balance;
        const label = `${arrow} ${d.contact_name}: ${formatAmount(amount, lang)}`;
        kb.text(label.slice(0, 60), `debt_${d.id}`).row();
    }
    if (prefix === "debt") {
        kb.text(t(lang, "view_closed"), "list_closed");
    } else if (prefix === "cdebt") {
        kb.text(t(lang, "btn_back"), "list_open");
    }
    return kb;
}

export function contactDebtsKeyboard(
    lang: Lang,
    list: DebtWithMeta[],
    contactId: number,
    status: "open" | "closed",
) {
    const kb = new InlineKeyboard();
    for (const d of list) {
        const arrow = d.direction === "borrowed" ? "📥" : "📤";
        const due = d.due_date ? ` · ${formatDate(d.due_date, lang)}` : "";
        const amount = status === "closed" ? d.initial_amount : d.balance;
        const label = `${arrow} ${formatAmount(amount, lang)}${due}`;
        kb.text(label.slice(0, 60), `debt_${d.id}`).row();
    }
    if (status === "open") {
        kb.text(t(lang, "view_closed"), `pclosed_${contactId}`).row();
    } else {
        kb.text(t(lang, "open_debts"), `pdebts_${contactId}`).row();
    }
    kb.text(t(lang, "edit_contact_name"), `rename_${contactId}`).row();
    kb.text(t(lang, "btn_back"), "people");
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

export function settingsKeyboard(lang: Lang, user: { notify_borrow: boolean; notify_lend: boolean; notify_time: string; language: Lang }) {
    const borrowState = user.notify_borrow ? t(lang, "on") : t(lang, "off");
    const lendState = user.notify_lend ? t(lang, "on") : t(lang, "off");

    return new InlineKeyboard()
        .text(`${t(lang, "settings_lang")}: ${user.language === "cyrl" ? "Кирилл" : "Lotin"}`, "settings_lang")
        .row()
        .text(`${t(lang, "settings_notify_time")}: ${user.notify_time}`, "settings_time")
        .row()
        .text(`${t(lang, "settings_notify_borrow")}: ${borrowState}`, "toggle_borrow")
        .row()
        .text(`${t(lang, "settings_notify_lend")}: ${lendState}`, "toggle_lend")
        .row()
        .text(t(lang, "settings_shares"), "settings_shares")
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

export function sharesListKeyboard(
    lang: Lang,
    items: { id: number; label: string }[],
) {
    const kb = new InlineKeyboard();
    kb.text(`➕ ${t(lang, "share_account_new")}`, "share_all_new").row();
    for (const item of items) {
        kb.text(`${t(lang, "revoke")}: ${item.label.slice(0, 40)}`, `revoke_${item.id}`).row();
    }
    kb.text(t(lang, "btn_back"), "settings");
    return kb;
}

export function actAsKeyboard(lang: Lang, accounts: { id: number; name: string }[]) {
    const kb = new InlineKeyboard();
    kb.text(t(lang, "act_as_self"), "actas_self").row();
    for (const a of accounts) {
        kb.text(`${t(lang, "act_as_other")}: ${a.name}`, `actas_${a.id}`).row();
    }
    kb.text(t(lang, "btn_cancel"), "cancel");
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

export function formatItemsPreview(lang: Lang, items: { type: string; amount: number; created_at: Date }[]): string {
    if (!items.length) return "—";
    return items
        .slice(0, 8)
        .map((i) => {
            const sign = i.type === "charge" ? "+" : "−";
            const d = formatDate(i.created_at.toISOString().slice(0, 10), lang);
            return `${sign}${formatAmount(i.amount, lang)} (${d})`;
        })
        .join("\n");
}
