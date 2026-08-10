import type { CTX, Direction, Lang, User } from "../utils/types";
import { t } from "../i18n";
import { saveUser } from "../services/save-user";
import {
    cancelKeyboard,
    cancelSkipKeyboard,
    contactDebtsKeyboard,
    dueDateKeyboard,
    contactPickerKeyboard,
    debtDetailKeyboard,
    debtListKeyboard,
    directionKeyboard,
    formatDebtCard,
    formatItemsPreview,
    mainReplyKeyboard,
    notifyTimeKeyboard,
    peopleListKeyboard,
    repayAmountKeyboard,
    summaryKeyboard,
} from "../services/keyboards";
import {
    addDebtItem,
    createDebt,
    createShareInvite,
    findOpenDebtId,
    getContactById,
    getDebtById,
    getDebtItems,
    listContactSummaries,
    listContacts,
    listContactsForPicker,
    listDebtsByContact,
    listOwnedDebts,
    contactHasActiveDebt,
    renameContact,
    repayDebt,
    resolveDebtAccess,
    setContactHideWhenZero,
    setDueDate,
    type CreateDebtResult,
    type DebtWithMeta,
} from "../services/debts";
import { clearSession, getSession, setSession } from "../services/session";
import {
    addDaysInTashkent,
    addMonthsInTashkent,
    firstOfNextMonthInTashkent,
    formatAmount,
    formatContactName,
    formatDate,
    normalizeContactName,
    contactNameHasForbiddenChars,
    parseAmount,
    parseDate,
    todayInTashkent,
} from "../utils/format";
import { sendErrorLog } from "../services/log";
import { paginate } from "../utils/paginate";
import type { InlineKeyboard } from "grammy";

async function editOrReply(ctx: CTX, text: string, replyMarkup: InlineKeyboard) {
    if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: replyMarkup }).catch(async () => {
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: replyMarkup });
        });
        return;
    }
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: replyMarkup });
}
import {
    notifyDebtCreated,
    notifyDebtDueChanged,
    notifyDebtItemAdded,
} from "../services/party-notify";
import { bot } from "../bot";

/** Tezkor sana tugmasi → ISO sana; null = tugma emas */
function resolveDuePreset(text: string, lang: Lang): string | null {
    const match = (...keys: string[]) => keys.some((k) => text === t(lang, k) || text === t("uz", k) || text === t("cyrl", k));

    if (match("due_today")) return todayInTashkent();
    if (match("due_tomorrow")) return addDaysInTashkent(1);
    if (match("due_in_3_days")) return addDaysInTashkent(3);
    if (match("due_in_1_week")) return addDaysInTashkent(7);
    if (match("due_next_month_1st")) return firstOfNextMonthInTashkent();
    if (match("due_in_1_month")) return addMonthsInTashkent(1);
    return null;
}

async function notifyAfterDebtCreate(result: CreateDebtResult, actor: User) {
    if (result.mergeType === "net" || result.mergeType === "repay") {
        if (result.amount > 0 && result.settledDebtId) {
            const settled = await getDebtById(result.settledDebtId);
            await notifyDebtItemAdded({
                debtId: result.settledDebtId,
                actor,
                type: "repay",
                amount: result.amount,
                balance: settled?.balance ?? 0,
                closed: !!result.closed,
            });
        }
        if (result.mergeType === "net" && result.remainderDebt) {
            await notifyDebtCreated({ debt: result.remainderDebt, actor });
        }
        return;
    }
    if (result.merged) {
        if (result.amount <= 0) return;
        await notifyDebtItemAdded({
            debtId: result.debt.id,
            actor,
            type: "charge",
            amount: result.amount,
            balance: result.debt.balance,
            closed: !!result.closed,
        });
        return;
    }
    await notifyDebtCreated({ debt: result.debt, actor });
}

function titleAfterDebtCreate(lang: Lang, result: CreateDebtResult): string {
    if (!result.merged) return t(lang, "debt_created");
    if (result.mergeType === "net") {
        const lines: string[] = [];
        if (result.amount > 0) {
            lines.push(t(lang, "repaid"));
            if (result.closed) lines.push(t(lang, "remain_zero_closed"));
        }
        if (result.remainderAmount && result.remainderDebt) {
            lines.push(t(lang, "debt_created"));
        }
        return lines.join("\n") || t(lang, "debt_created");
    }
    if (result.mergeType === "repay") {
        return result.closed ? `${t(lang, "repaid")}\n${t(lang, "remain_zero_closed")}` : t(lang, "repaid");
    }
    return t(lang, "charged");
}

async function replyAfterDebtCreate(ctx: CTX, lang: Lang, result: CreateDebtResult) {
    const title = titleAfterDebtCreate(lang, result);
    // Faqat yopilgan qaytarish — 0 balansli kartani ko'rsatmaslik
    if (result.mergeType === "repay" && result.closed && !result.remainderDebt) {
        await ctx.reply(title, { reply_markup: mainReplyKeyboard(lang) });
        return;
    }
    await ctx.reply(`${title}\n\n${formatDebtCard(lang, result.debt)}`, {
        parse_mode: "HTML",
        reply_markup: mainReplyKeyboard(lang),
    });
}

const NOTE_MAX_LEN = 200;

function normalizeItemNote(text: string): string | null | "invalid" {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) return null;
    if (trimmed.length > NOTE_MAX_LEN) return "invalid";
    return trimmed;
}

async function askItemNote(ctx: CTX, lang: Lang) {
    await ctx.reply(`${t(lang, "ask_item_note")}\n${t(lang, "note_hint")}`, {
        reply_markup: cancelSkipKeyboard(lang),
    });
}

async function continueAfterItemNote(ctx: CTX, user: User, lang: Lang, note: string | null) {
    const session = getSession(ctx.from!.id);
    const action = session.itemAction;

    if (action === "add") {
        if (!session.direction || !session.contactName || !session.amount) {
            clearSession(ctx.from!.id);
            await ctx.reply(t(lang, "cancelled"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }

        if (session.needsDueDate) {
            setSession(ctx.from!.id, {
                step: "add_due_date",
                amount: session.amount,
                note,
                contactName: session.contactName,
                contactId: session.contactId,
                direction: session.direction,
                itemAction: undefined,
                needsDueDate: undefined,
            });
            await ctx.reply(t(lang, "ask_due_date"), { reply_markup: dueDateKeyboard(lang) });
            return;
        }

        const result = await createDebt({
            ownerId: user.id,
            contactName: session.contactName,
            direction: session.direction,
            amount: session.amount,
            dueDate: null,
            createdBy: user.id,
            contactId: session.contactId,
            note,
        });
        clearSession(ctx.from!.id);
        await notifyAfterDebtCreate(result, user);
        await replyAfterDebtCreate(ctx, lang, result);
        return;
    }

    if (action === "repay" && session.debtId && session.amount) {
        const access = await resolveDebtAccess(user, session.debtId);
        if (!access.canWrite) {
            clearSession(ctx.from!.id);
            await ctx.reply(t(lang, "write_denied"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }
        const debtId = session.debtId;
        const amount = session.amount;
        const result = await repayDebt({
            debtId,
            amount,
            createdBy: user.id,
            ownerId: user.id,
            note,
        });
        clearSession(ctx.from!.id);

        if (result.repayAmount > 0) {
            await notifyDebtItemAdded({
                debtId,
                actor: user,
                type: "repay",
                amount: result.repayAmount,
                balance: result.balance,
                closed: result.closed,
            });
        }

        let msg = `${t(lang, "repaid")}\n${t(lang, "balance")}: ${formatAmount(result.balance, lang)}`;
        if (result.closed) msg += `\n${t(lang, "remain_zero_closed")}`;

        if (result.remainderCreate && result.remainderAmount) {
            await notifyAfterDebtCreate(result.remainderCreate, user);
            msg += `\n\n${t(lang, "repay_overflow_new_debt", {
                amount: formatAmount(result.remainderAmount, lang),
            })}`;
            msg += `\n\n${formatDebtCard(lang, result.remainderCreate.debt)}`;
            await ctx.reply(msg, {
                parse_mode: "HTML",
                reply_markup: mainReplyKeyboard(lang),
            });
            return;
        }

        await ctx.reply(msg, { reply_markup: mainReplyKeyboard(lang) });
        return;
    }

    if (action === "charge" && session.debtId && session.amount) {
        const access = await resolveDebtAccess(user, session.debtId);
        if (!access.canWrite) {
            clearSession(ctx.from!.id);
            await ctx.reply(t(lang, "write_denied"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }
        const debtId = session.debtId;
        const amount = session.amount;
        const result = await addDebtItem({
            debtId,
            type: "charge",
            amount,
            createdBy: user.id,
            note,
        });
        clearSession(ctx.from!.id);
        await notifyDebtItemAdded({
            debtId,
            actor: user,
            type: "charge",
            amount,
            balance: result.balance,
            closed: result.closed,
        });
        await ctx.reply(
            `${t(lang, "charged")}\n${t(lang, "balance")}: ${formatAmount(result.balance, lang)}`,
            { reply_markup: mainReplyKeyboard(lang) },
        );
        return;
    }

    clearSession(ctx.from!.id);
    await ctx.reply(t(lang, "cancelled"), { reply_markup: mainReplyKeyboard(lang) });
}

async function beginAddDebtFlow(ctx: CTX) {
    const [user] = await saveUser(ctx);
    if (!user) return;
    clearSession(ctx.from!.id);
    setSession(ctx.from!.id, {
        step: "idle",
        direction: undefined,
        contactName: undefined,
        contactId: undefined,
        amount: undefined,
        note: undefined,
        itemAction: undefined,
        needsDueDate: undefined,
        debtId: undefined,
    });
    await ctx.reply(t(user.language, "choose_direction"), {
        reply_markup: directionKeyboard(user.language),
    });
}

export async function startAddDebt(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        clearSession(ctx.from!.id);
        await beginAddDebtFlow(ctx);
    } catch (error) {
        await sendErrorLog({ event: "startAddDebt", error, ctx });
    }
}

export async function onDirection(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const data = ctx.callbackQuery?.data || "";
        const direction: Direction = data === "dir_lent" ? "lent" : "borrowed";

        setSession(ctx.from!.id, {
            step: "add_contact_name",
            direction,
        });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);

        const known = await listContactsForPicker(user.id);
        if (known.length > 0) {
            await showContactPicker(ctx, 0);
            return;
        }

        await ctx.reply(`${t(user.language, "ask_contact_type")}\n${t(user.language, "contact_hint")}`, {
            reply_markup: cancelKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onDirection", error, ctx });
    }
}

export async function showContactPicker(ctx: CTX, page = 0) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const session = getSession(ctx.from!.id);
        if (!session.direction) {
            clearSession(ctx.from!.id);
            await ctx.reply(t(user.language, "cancelled"), { reply_markup: mainReplyKeyboard(user.language) });
            return;
        }

        const known = await listContactsForPicker(user.id);
        if (!known.length) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery().catch(() => undefined);
                await ctx.deleteMessage().catch(() => undefined);
            }
            await ctx.reply(`${t(user.language, "ask_contact_type")}\n${t(user.language, "contact_hint")}`, {
                reply_markup: cancelKeyboard(user.language),
            });
            return;
        }
        const { slice, page: p, totalPages, total } = paginate(known, page);
        const suffix =
            totalPages > 1 ? t(user.language, "list_page_suffix", { page: p + 1, total: totalPages }) : "";
        const text = `${t(user.language, "ask_contact_pick")} (${total})${suffix}`;
        const markup = contactPickerKeyboard(
            user.language,
            slice.map((c) => ({ id: c.id, name: c.name })),
            p,
            totalPages,
        );

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.editMessageText(text, { reply_markup: markup }).catch(async () => {
                await ctx.reply(text, { reply_markup: markup });
            });
        } else {
            await ctx.reply(text, { reply_markup: markup });
        }
    } catch (error) {
        await sendErrorLog({ event: "showContactPicker", error, ctx });
    }
}

export async function onContactPick(ctx: CTX, contactId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const session = getSession(ctx.from!.id);
        if (!session.direction) {
            await ctx.answerCallbackQuery({ text: t(user.language, "cancelled") }).catch(() => undefined);
            return;
        }

        const contact = await getContactById(contactId, user.id);
        if (!contact) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        setSession(ctx.from!.id, {
            step: "add_amount",
            contactName: contact.name,
            contactId: contact.id,
            direction: session.direction,
        });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);
        await ctx.reply(`${t(user.language, "ask_amount")}\n${t(user.language, "amount_hint")}`, {
            reply_markup: cancelKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onContactPick", error, ctx });
    }
}

export async function showPeopleList(ctx: CTX, page = 0) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const summaries = await listContactSummaries(user.id);
        setSession(ctx.from!.id, { step: "idle", browseContactId: undefined });

        if (!summaries.length) {
            clearSession(ctx.from!.id);
            if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.reply(t(user.language, "no_people"), { reply_markup: mainReplyKeyboard(user.language) });
            return;
        }

        const { slice, page: p, totalPages, total } = paginate(summaries, page);
        const suffix = totalPages > 1 ? t(user.language, "list_page_suffix", { page: p + 1, total: totalPages }) : "";
        const lines = [
            `${t(user.language, "people_title")} (${total})${suffix}`,
            "",
            ...slice.map((s) =>
                t(user.language, "people_summary_line", {
                    name: s.name,
                    borrowed: formatAmount(s.borrowedBalance, user.language),
                    lent: formatAmount(s.lentBalance, user.language),
                }),
            ),
        ];

        await editOrReply(ctx, lines.join("\n"), peopleListKeyboard(user.language, slice, p, totalPages));
    } catch (error) {
        await sendErrorLog({ event: "showPeopleList", error, ctx });
    }
}

export async function showContactDebts(
    ctx: CTX,
    contactId: number,
    status: "open" | "closed" = "open",
    page = 0,
) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const contact = await getContactById(contactId, user.id);
        if (!contact) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        setSession(ctx.from!.id, {
            step: "idle",
            browseContactId: contactId,
            browseDebtStatus: status,
            contactId,
            contactName: contact.name,
        });

        const list = await listDebtsByContact(user.id, contactId, status);
        const hasActive = await contactHasActiveDebt(user.id, contactId);
        const { slice, page: p, totalPages, total } = paginate(list, page);
        const title = t(user.language, "people_contact_debts", { name: formatContactName(contact.name) });
        const statusLabel = status === "open" ? t(user.language, "open_debts") : t(user.language, "closed_debts");
        const suffix = totalPages > 1 ? t(user.language, "list_page_suffix", { page: p + 1, total: totalPages }) : "";
        const text = total
            ? `${title}\n${statusLabel}: ${total}${suffix}`
            : `${title}\n${status === "open" ? t(user.language, "no_debts") : `${statusLabel}: 0`}`;

        await editOrReply(
            ctx,
            text,
            contactDebtsKeyboard(
                user.language,
                slice,
                contactId,
                status,
                p,
                totalPages,
                contact.hide_when_zero,
                !hasActive,
            ),
        );
    } catch (error) {
        await sendErrorLog({ event: "showContactDebts", error, ctx });
    }
}

export async function onToggleHideWhenZero(ctx: CTX, contactId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const contact = await getContactById(contactId, user.id);
        if (!contact) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        const next = !contact.hide_when_zero;
        const result = await setContactHideWhenZero(contactId, user.id, next);
        if (!result.ok) {
            const msg =
                result.reason === "has_active"
                    ? t(user.language, "hide_when_zero_denied")
                    : t(user.language, "no_permission");
            await ctx.answerCallbackQuery({ text: msg }).catch(() => undefined);
            await showContactDebts(ctx, contactId, "open", 0);
            return;
        }

        await ctx
            .answerCallbackQuery({
                text: t(user.language, next ? "hide_when_zero_set_on" : "hide_when_zero_set_off"),
            })
            .catch(() => undefined);

        await showContactDebts(ctx, contactId, "open", 0);
    } catch (error) {
        await sendErrorLog({ event: "onToggleHideWhenZero", error, ctx });
    }
}

export async function onRenameContactStart(ctx: CTX, contactId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const contact = await getContactById(contactId, user.id);
        if (!contact) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        setSession(ctx.from!.id, {
            step: "rename_contact",
            contactId,
            browseContactId: contactId,
            contactName: contact.name,
        });

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.reply(t(user.language, "ask_rename_contact", { name: formatContactName(contact.name) }), {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onRenameContactStart", error, ctx });
    }
}

export async function showDebtList(ctx: CTX, status: "open" | "closed" = "open", page = 0) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const list = await listOwnedDebts(user.id, status);
        setSession(ctx.from!.id, {
            step: "idle",
            browseContactId: undefined,
            browseDebtStatus: status,
        });

        const prefix = status === "open" ? ("debt" as const) : ("cdebt" as const);
        const { slice, page: p, totalPages, total } = paginate(list, page);

        if (!total) {
            const text =
                status === "open"
                    ? t(user.language, "no_debts")
                    : `${t(user.language, "closed_debts")}: 0`;
            await editOrReply(ctx, text, debtListKeyboard(user.language, [], prefix, 0, 1));
            return;
        }

        const title =
            status === "open" ? t(user.language, "open_debts") : t(user.language, "closed_debts");
        const suffix =
            totalPages > 1 ? t(user.language, "list_page_suffix", { page: p + 1, total: totalPages }) : "";
        const text = `<b>${title}</b> (${total})${suffix}`;

        await editOrReply(ctx, text, debtListKeyboard(user.language, slice, prefix, p, totalPages));
    } catch (error) {
        await sendErrorLog({ event: "showDebtList", error, ctx });
    }
}

function buildSummaryLines(lang: Lang, list: DebtWithMeta[]): string[] {
    return list.map((d) => {
        const amount = formatAmount(d.balance, lang);
        if (d.due_date) {
            return t(lang, "summary_line_due", {
                name: d.contact_name,
                amount,
                due: formatDate(d.due_date, lang),
            });
        }
        return t(lang, "summary_line", { name: d.contact_name, amount });
    });
}

/** Ochiq qarzlar matnli hisoboti — sahifalangan */
export async function showDebtSummary(ctx: CTX, page = 0) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const lang = user.language;
        clearSession(ctx.from!.id);

        const open = await listOwnedDebts(user.id, "open");
        const borrowed = open.filter((d) => d.direction === "borrowed");
        const lent = open.filter((d) => d.direction === "lent");

        if (!borrowed.length && !lent.length) {
            if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.reply(t(lang, "summary_none"), {
                reply_markup: mainReplyKeyboard(lang),
            });
            return;
        }

        const borrowedTotal = borrowed.reduce((s, d) => s + d.balance, 0);
        const lentTotal = lent.reduce((s, d) => s + d.balance, 0);

        const blocks: string[] = [];
        blocks.push(`<b>${t(lang, "summary_borrowed")}</b>`);
        if (!borrowed.length) blocks.push(t(lang, "summary_empty"));
        else {
            blocks.push(...buildSummaryLines(lang, borrowed));
            blocks.push(t(lang, "summary_total", { amount: formatAmount(borrowedTotal, lang) }));
        }
        blocks.push("");
        blocks.push(`<b>${t(lang, "summary_lent")}</b>`);
        if (!lent.length) blocks.push(t(lang, "summary_empty"));
        else {
            blocks.push(...buildSummaryLines(lang, lent));
            blocks.push(t(lang, "summary_total", { amount: formatAmount(lentTotal, lang) }));
        }

        const { slice, page: p, totalPages } = paginate(blocks, page);
        const suffix =
            totalPages > 1 ? t(lang, "list_page_suffix", { page: p + 1, total: totalPages }) : "";
        const text = [`<b>${t(lang, "summary_title")}</b>${suffix}`, "", ...slice].join("\n");

        await editOrReply(ctx, text, summaryKeyboard(lang, p, totalPages));
    } catch (error) {
        await sendErrorLog({ event: "showDebtSummary", error, ctx });
    }
}

export async function showDebtDetail(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const access = await resolveDebtAccess(user, debtId);
        if (!access.canView) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        const debt = await getDebtById(debtId);
        if (!debt) return;

        const session = getSession(ctx.from!.id);
        let backCallback = "list_open";
        if (session.browseContactId && session.browseContactId === debt.contact_id) {
            backCallback =
                session.browseDebtStatus === "closed"
                    ? `pclosed_${debt.contact_id}`
                    : `pdebts_${debt.contact_id}`;
        } else if (session.browseDebtStatus === "closed") {
            backCallback = "list_closed";
        }

        const items = await getDebtItems(debtId);
        const preview = formatItemsPreview(user.language, items);
        const text = formatDebtCard(user.language, debt, preview);

        const canShare = access.isOwner && !debt.linked_debt_id;

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: debtDetailKeyboard(
                user.language,
                debtId,
                access.canWrite && debt.status === "open",
                access.isOwner,
                backCallback,
                canShare,
                !!debt.due_date,
            ),
        }).catch(async () => {
            await ctx.reply(text, {
                parse_mode: "HTML",
                reply_markup: debtDetailKeyboard(
                    user.language,
                    debtId,
                    access.canWrite && debt.status === "open",
                    access.isOwner,
                    backCallback,
                    canShare,
                    !!debt.due_date,
                ),
            });
        });
    } catch (error) {
        await sendErrorLog({ event: "showDebtDetail", error, ctx });
    }
}

export async function onRepayStart(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const access = await resolveDebtAccess(user, debtId);
        if (!access.canWrite) {
            await ctx.answerCallbackQuery({ text: t(user.language, "write_denied") }).catch(() => undefined);
            return;
        }
        setSession(ctx.from!.id, { step: "repay_amount", debtId });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.reply(t(user.language, "ask_repay"), { reply_markup: repayAmountKeyboard(user.language) });
    } catch (error) {
        await sendErrorLog({ event: "onRepayStart", error, ctx });
    }
}

export async function onChargeStart(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const access = await resolveDebtAccess(user, debtId);
        if (!access.canWrite) {
            await ctx.answerCallbackQuery({ text: t(user.language, "write_denied") }).catch(() => undefined);
            return;
        }
        setSession(ctx.from!.id, { step: "charge_amount", debtId });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.reply(t(user.language, "ask_charge"), { reply_markup: cancelKeyboard(user.language) });
    } catch (error) {
        await sendErrorLog({ event: "onChargeStart", error, ctx });
    }
}

export async function onDueStart(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const access = await resolveDebtAccess(user, debtId);
        if (!access.canWrite) {
            await ctx.answerCallbackQuery({ text: t(user.language, "write_denied") }).catch(() => undefined);
            return;
        }
        setSession(ctx.from!.id, { step: "set_due_date", debtId });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.reply(t(user.language, "ask_due_date"), { reply_markup: dueDateKeyboard(user.language) });
    } catch (error) {
        await sendErrorLog({ event: "onDueStart", error, ctx });
    }
}

export async function onShareStart(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const access = await resolveDebtAccess(user, debtId);
        if (!access.isOwner) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        const invite = await createShareInvite({
            granterId: user.id,
            debtId,
        });

        if (!invite.ok) {
            const msg =
                invite.error === "already_linked"
                    ? t(user.language, "share_already_linked")
                    : t(user.language, "no_permission");
            await ctx.answerCallbackQuery({ text: msg }).catch(() => undefined);
            return;
        }

        const me = await bot.api.getMe();
        const link = `https://t.me/${me.username}?start=share_${invite.token}`;
        const debt = await getDebtById(debtId);

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(`${t(user.language, "share_link_debt")}\n\n<code>${link}</code>`, {
            parse_mode: "HTML",
            reply_markup: debtDetailKeyboard(
                user.language,
                debtId,
                true,
                true,
                "list_open",
                true,
                !!debt?.due_date,
            ),
        }).catch(async () => {
            await ctx.reply(`${t(user.language, "share_link_debt")}\n\n<code>${link}</code>`, {
                parse_mode: "HTML",
                reply_markup: mainReplyKeyboard(user.language),
            });
        });
    } catch (error) {
        await sendErrorLog({ event: "onShareStart", error, ctx });
    }
}

export async function onNotifyTimeMenu(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(t(user.language, "notify_time_ask"), {
            reply_markup: notifyTimeKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onNotifyTimeMenu", error, ctx });
    }
}

export async function onNotifyTimeSet(ctx: CTX, time: string) {
    try {
        const [user] = await saveUser(ctx, { notify_time: time });
        if (!user) return;
        await ctx.answerCallbackQuery({ text: t(user.language, "notify_time_set") }).catch(() => undefined);
        const { showSettings } = await import("./action-settings");
        await showSettings(ctx);
    } catch (error) {
        await sendErrorLog({ event: "onNotifyTimeSet", error, ctx });
    }
}

export async function handleTextMessage(ctx: CTX) {
    try {
        if (!ctx.from || !ctx.message || !("text" in ctx.message) || !ctx.message.text) return;
        const text = ctx.message.text.trim();
        const [user] = await saveUser(ctx);
        if (!user) return;
        const lang = user.language;

        // Reply keyboard buttons
        if (text === t(lang, "btn_add") || text === t("uz", "btn_add") || text === t("cyrl", "btn_add")) {
            await startAddDebt(ctx);
            return;
        }
        if (text === t(lang, "btn_list") || text === t("uz", "btn_list") || text === t("cyrl", "btn_list")) {
            await showDebtList(ctx, "open");
            return;
        }
        if (text === t(lang, "btn_people") || text === t("uz", "btn_people") || text === t("cyrl", "btn_people")) {
            await showPeopleList(ctx);
            return;
        }
        if (text === t(lang, "btn_summary") || text === t("uz", "btn_summary") || text === t("cyrl", "btn_summary")) {
            await showDebtSummary(ctx);
            return;
        }
        if (text === t(lang, "btn_settings") || text === t("uz", "btn_settings") || text === t("cyrl", "btn_settings")) {
            const { showSettings } = await import("./action-settings");
            await showSettings(ctx);
            return;
        }

        if (text === t(lang, "btn_cancel") || text === t("uz", "btn_cancel") || text === t("cyrl", "btn_cancel")) {
            clearSession(ctx.from.id);
            await ctx.reply(t(lang, "cancelled"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }

        const session = getSession(ctx.from.id);

        if (session.step === "rename_contact" && session.contactId) {
            const result = await renameContact(session.contactId, user.id, text);
            if (!result.ok) {
                if (result.reason === "taken") {
                    await ctx.reply(t(lang, "contact_name_taken"), { reply_markup: cancelKeyboard(lang) });
                    return;
                }
                if (contactNameHasForbiddenChars(text)) {
                    await ctx.reply(t(lang, "invalid_contact_name"), { reply_markup: cancelKeyboard(lang) });
                    return;
                }
                await ctx.reply(`${t(lang, "ask_contact")}\n${t(lang, "contact_hint")}`, {
                    reply_markup: cancelKeyboard(lang),
                });
                return;
            }

            const contactId = result.contact.id;
            await ctx.reply(t(lang, "contact_renamed", { name: formatContactName(result.contact.name) }), {
                parse_mode: "HTML",
            });
            await showContactDebts(ctx, contactId, "open");
            return;
        }

        if (text === t(lang, "btn_skip") || text === t("uz", "btn_skip") || text === t("cyrl", "btn_skip")) {
            if (session.step === "item_note") {
                await continueAfterItemNote(ctx, user, lang, null);
                return;
            }
            if (session.step === "add_due_date" && session.direction && session.contactName && session.amount) {
                const result = await createDebt({
                    ownerId: user.id,
                    contactName: session.contactName,
                    direction: session.direction,
                    amount: session.amount,
                    dueDate: null,
                    createdBy: user.id,
                    contactId: session.contactId,
                    note: session.note,
                });
                clearSession(ctx.from.id);
                await notifyAfterDebtCreate(result, user);
                await replyAfterDebtCreate(ctx, lang, result);
                return;
            }
            if (session.step === "set_due_date" && session.debtId) {
                const debtId = session.debtId;
                await setDueDate(debtId, null);
                clearSession(ctx.from.id);
                await notifyDebtDueChanged({ debtId, actor: user, dueDate: null });
                await ctx.reply(t(lang, "due_set"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }
        }

        if (session.step === "item_note") {
            const note = normalizeItemNote(text);
            if (note === "invalid") {
                await ctx.reply(t(lang, "invalid_note"), { reply_markup: cancelSkipKeyboard(lang) });
                return;
            }
            await continueAfterItemNote(ctx, user, lang, note);
            return;
        }

        if (session.step === "add_contact_name") {
            if (contactNameHasForbiddenChars(text)) {
                await ctx.reply(t(lang, "invalid_contact_name"), { reply_markup: cancelKeyboard(lang) });
                return;
            }
            const known = await listContacts(user.id);
            const stored = normalizeContactName(text);
            const matched = known.find((c) => c.name === stored);
            const contactName = matched?.name ?? stored;

            if (contactName.length < 1 || contactName.length > 80) {
                await ctx.reply(t(lang, "ask_contact"));
                return;
            }

            setSession(ctx.from.id, {
                step: "add_amount",
                contactName,
                contactId: matched?.id,
                direction: session.direction,
            });
            await ctx.reply(`${t(lang, "ask_amount")}\n${t(lang, "amount_hint")}`, {
                reply_markup: cancelKeyboard(lang),
            });
            return;
        }

        if (session.step === "add_amount") {
            const amount = parseAmount(text);
            if (!amount) {
                await ctx.reply(t(lang, "invalid_amount"));
                return;
            }
            if (!session.direction || !session.contactName) {
                clearSession(ctx.from.id);
                await ctx.reply(t(lang, "cancelled"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }

            const oppositeDir = session.direction === "borrowed" ? "lent" : "borrowed";
            // Bir xil yoki teskari ochiq qarz bor — sana so'ralmasin (charge yoki repay)
            const openId =
                (await findOpenDebtId(user.id, session.contactName, session.direction, session.contactId)) ??
                (await findOpenDebtId(user.id, session.contactName, oppositeDir, session.contactId));

            setSession(ctx.from.id, {
                step: "item_note",
                amount,
                contactName: session.contactName,
                contactId: session.contactId,
                direction: session.direction,
                itemAction: "add",
                needsDueDate: !openId,
                note: undefined,
            });
            await askItemNote(ctx, lang);
            return;
        }

        if (session.step === "add_due_date") {
            if (!session.direction || !session.contactName || !session.amount) {
                clearSession(ctx.from.id);
                await ctx.reply(t(lang, "cancelled"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }

            const preset = resolveDuePreset(text, lang);
            const due = preset ?? parseDate(text);
            if (!due) {
                await ctx.reply(t(lang, "invalid_date"), { reply_markup: dueDateKeyboard(lang) });
                return;
            }

            const result = await createDebt({
                ownerId: user.id,
                contactName: session.contactName,
                direction: session.direction,
                amount: session.amount,
                dueDate: due,
                createdBy: user.id,
                contactId: session.contactId,
                note: session.note,
            });
            clearSession(ctx.from.id);
            await notifyAfterDebtCreate(result, user);
            await replyAfterDebtCreate(ctx, lang, result);
            return;
        }

        if (session.step === "repay_amount" && session.debtId) {
            const access = await resolveDebtAccess(user, session.debtId);
            if (!access.canWrite) {
                clearSession(ctx.from.id);
                await ctx.reply(t(lang, "write_denied"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }

            const isAll =
                text === t(lang, "btn_repay_all") ||
                text === t("uz", "btn_repay_all") ||
                text === t("cyrl", "btn_repay_all");

            let amount = parseAmount(text);
            if (isAll) {
                const debt = await getDebtById(session.debtId);
                amount = debt && debt.balance > 0 ? debt.balance : null;
            }
            if (!amount) {
                await ctx.reply(t(lang, "invalid_amount"), { reply_markup: repayAmountKeyboard(lang) });
                return;
            }

            // «Hammasi» — izoh so'ralmasin, avtomatik yoziladi
            if (isAll) {
                setSession(ctx.from.id, {
                    step: "item_note",
                    debtId: session.debtId,
                    amount,
                    itemAction: "repay",
                });
                await continueAfterItemNote(ctx, user, lang, t(lang, "note_repay_all"));
                return;
            }

            setSession(ctx.from.id, {
                step: "item_note",
                debtId: session.debtId,
                amount,
                itemAction: "repay",
                note: undefined,
            });
            await askItemNote(ctx, lang);
            return;
        }

        if (session.step === "charge_amount" && session.debtId) {
            const amount = parseAmount(text);
            if (!amount) {
                await ctx.reply(t(lang, "invalid_amount"));
                return;
            }
            const access = await resolveDebtAccess(user, session.debtId);
            if (!access.canWrite) {
                clearSession(ctx.from.id);
                await ctx.reply(t(lang, "write_denied"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }
            setSession(ctx.from.id, {
                step: "item_note",
                debtId: session.debtId,
                amount,
                itemAction: "charge",
                note: undefined,
            });
            await askItemNote(ctx, lang);
            return;
        }

        if (session.step === "set_due_date" && session.debtId) {
            const preset = resolveDuePreset(text, lang);
            const due = preset ?? parseDate(text);
            if (!due) {
                await ctx.reply(t(lang, "invalid_date"), { reply_markup: dueDateKeyboard(lang) });
                return;
            }
            const access = await resolveDebtAccess(user, session.debtId);
            if (!access.canWrite) {
                clearSession(ctx.from.id);
                await ctx.reply(t(lang, "write_denied"), { reply_markup: mainReplyKeyboard(lang) });
                return;
            }
            const debtId = session.debtId;
            await setDueDate(debtId, due);
            clearSession(ctx.from.id);
            await notifyDebtDueChanged({ debtId, actor: user, dueDate: due });
            await ctx.reply(t(lang, "due_set"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }
    } catch (error) {
        await sendErrorLog({ event: "handleTextMessage", error, ctx });
    }
}
