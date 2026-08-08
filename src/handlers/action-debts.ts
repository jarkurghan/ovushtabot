import type { CTX, Direction, Lang } from "../utils/types";
import { t } from "../i18n";
import { saveUser, getUserById } from "../services/save-user";
import {
    actAsKeyboard,
    cancelKeyboard,
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
    peopleBrowseKeyboard,
    repayAmountKeyboard,
    sharesListKeyboard,
} from "../services/keyboards";
import {
    addDebtItem,
    closeDebt,
    createDebt,
    createShareInvite,
    getContactById,
    getDebtById,
    getDebtItems,
    listContactSummaries,
    listContacts,
    listDebtsByContact,
    listIncomingAccountShares,
    listOwnedDebts,
    listOutgoingAccountShares,
    renameContact,
    resolveDebtAccess,
    revokeShare,
    setDueDate,
    type DebtWithMeta,
} from "../services/debts";
import { clearSession, getSession, setSession } from "../services/session";
import {
    addDaysInTashkent,
    addMonthsInTashkent,
    firstOfNextMonthInTashkent,
    formatAmount,
    formatDate,
    parseAmount,
    parseDate,
    todayInTashkent,
} from "../utils/format";

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
import { sendErrorLog } from "../services/log";
import {
    notifyDebtClosed,
    notifyDebtCreated,
    notifyDebtDueChanged,
    notifyDebtItemAdded,
} from "../services/party-notify";
import { bot } from "../bot";

async function beginAddDebtFlow(ctx: CTX, asOwnerId?: number) {
    const [user] = await saveUser(ctx);
    if (!user) return;
    setSession(ctx.from!.id, { step: "idle", asOwnerId: asOwnerId || user.id });
    await ctx.reply(t(user.language, "choose_direction"), {
        reply_markup: directionKeyboard(user.language),
    });
}

export async function startAddDebt(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        clearSession(ctx.from!.id);

        const accountShares = await listIncomingAccountShares(user.id);
        if (accountShares.length > 0) {
            const accounts: { id: number; name: string }[] = [];
            for (const s of accountShares) {
                const owner = await getUserById(s.granter_id);
                if (owner) accounts.push({ id: owner.id, name: owner.first_name || String(owner.tg_id) });
            }
            await ctx.reply(t(user.language, "act_as_choose"), {
                reply_markup: actAsKeyboard(user.language, accounts),
            });
            return;
        }

        await beginAddDebtFlow(ctx, user.id);
    } catch (error) {
        await sendErrorLog({ event: "startAddDebt", error, ctx });
    }
}

export async function onActAs(ctx: CTX, asOwnerId: number | "self") {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);

        if (asOwnerId === "self") {
            await beginAddDebtFlow(ctx, user.id);
            return;
        }

        const shares = await listIncomingAccountShares(user.id);
        if (!shares.some((s) => s.granter_id === asOwnerId)) {
            await ctx.reply(t(user.language, "no_permission"), { reply_markup: mainReplyKeyboard(user.language) });
            return;
        }
        await beginAddDebtFlow(ctx, asOwnerId);
    } catch (error) {
        await sendErrorLog({ event: "onActAs", error, ctx });
    }
}

export async function onDirection(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const data = ctx.callbackQuery?.data || "";
        const direction: Direction = data === "dir_lent" ? "lent" : "borrowed";
        const prev = getSession(ctx.from!.id);
        const ownerId = prev.asOwnerId || user.id;

        setSession(ctx.from!.id, {
            step: "add_contact_name",
            direction,
            asOwnerId: ownerId,
        });
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.deleteMessage().catch(() => undefined);

        const known = await listContacts(ownerId);
        if (known.length > 0) {
            await ctx.reply(t(user.language, "ask_contact_pick"), {
                reply_markup: contactPickerKeyboard(
                    user.language,
                    known.map((c) => ({ id: c.id, name: c.name })),
                ),
            });
            return;
        }

        await ctx.reply(`${t(user.language, "ask_contact_type")}\n${t(user.language, "contact_hint")}`, {
            reply_markup: cancelKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onDirection", error, ctx });
    }
}

export async function showPeopleList(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const summaries = await listContactSummaries(user.id);
        setSession(ctx.from!.id, { step: "browse_contacts", browseContactId: undefined });

        if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);

        if (!summaries.length) {
            clearSession(ctx.from!.id);
            await ctx.reply(t(user.language, "no_people"), { reply_markup: mainReplyKeyboard(user.language) });
            return;
        }

        const lines = [
            t(user.language, "people_title"),
            "",
            ...summaries.map((s) =>
                t(user.language, "people_summary_line", {
                    name: s.name,
                    borrowed: formatAmount(s.borrowedBalance, user.language),
                    lent: formatAmount(s.lentBalance, user.language),
                }),
            ),
        ];

        await ctx.reply(lines.join("\n"), {
            parse_mode: "HTML",
            reply_markup: peopleBrowseKeyboard(
                user.language,
                summaries.map((s) => ({ name: s.name })),
            ),
        });
    } catch (error) {
        await sendErrorLog({ event: "showPeopleList", error, ctx });
    }
}

export async function showContactDebts(ctx: CTX, contactId: number, status: "open" | "closed" = "open") {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const contact = await getContactById(contactId, user.id);
        if (!contact) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        setSession(ctx.from!.id, {
            step: "browse_contacts",
            browseContactId: contactId,
            contactId,
            contactName: contact.name,
        });

        const list = await listDebtsByContact(user.id, contactId, status);
        const title = t(user.language, "people_contact_debts", { name: contact.name });
        const text = list.length
            ? `${title}\n${status === "open" ? t(user.language, "open_debts") : t(user.language, "closed_debts")}: ${list.length}`
            : `${title}\n${status === "open" ? t(user.language, "no_debts") : t(user.language, "closed_debts") + ": 0"}`;

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery().catch(() => undefined);
            await ctx.editMessageText(text, {
                parse_mode: "HTML",
                reply_markup: contactDebtsKeyboard(user.language, list, contactId, status),
            }).catch(async () => {
                await ctx.reply(text, {
                    parse_mode: "HTML",
                    reply_markup: contactDebtsKeyboard(user.language, list, contactId, status),
                });
            });
        } else {
            await ctx.reply(text, {
                parse_mode: "HTML",
                reply_markup: contactDebtsKeyboard(user.language, list, contactId, status),
            });
        }
    } catch (error) {
        await sendErrorLog({ event: "showContactDebts", error, ctx });
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
        await ctx.reply(t(user.language, "ask_rename_contact", { name: contact.name }), {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard(user.language),
        });
    } catch (error) {
        await sendErrorLog({ event: "onRenameContactStart", error, ctx });
    }
}

export async function showDebtList(ctx: CTX, status: "open" | "closed" = "open") {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const list = await listOwnedDebts(user.id, status);
        setSession(ctx.from!.id, {
            step: "idle",
            browseContactId: undefined,
        });

        if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);

        const prefix = status === "open" ? "debt" : "cdebt";

        if (!list.length) {
            const text =
                status === "open"
                    ? t(user.language, "no_debts")
                    : t(user.language, "closed_debts") + ": 0";
            const replyMarkup = debtListKeyboard(user.language, [], prefix);
            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, {
                    reply_markup: replyMarkup,
                }).catch(async () => {
                    await ctx.reply(text, { reply_markup: replyMarkup });
                });
            } else {
                await ctx.reply(text, { reply_markup: replyMarkup });
            }
            return;
        }

        const title =
            status === "open" ? t(user.language, "open_debts") : t(user.language, "closed_debts");
        const text = `<b>${title}</b> (${list.length})`;

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                parse_mode: "HTML",
                reply_markup: debtListKeyboard(user.language, list, prefix),
            }).catch(async () => {
                await ctx.reply(text, {
                    parse_mode: "HTML",
                    reply_markup: debtListKeyboard(user.language, list, prefix),
                });
            });
        } else {
            await ctx.reply(text, {
                parse_mode: "HTML",
                reply_markup: debtListKeyboard(user.language, list, prefix),
            });
        }
    } catch (error) {
        await sendErrorLog({ event: "showDebtList", error, ctx });
    }
}

function formatSummarySection(lang: Lang, titleKey: string, list: DebtWithMeta[]): string {
    const lines = [`<b>${t(lang, titleKey)}</b>`];
    if (!list.length) {
        lines.push(t(lang, "summary_empty"));
        return lines.join("\n");
    }

    for (const d of list) {
        const amount = formatAmount(d.balance, lang);
        if (d.due_date) {
            lines.push(
                t(lang, "summary_line_due", {
                    name: d.contact_name,
                    amount,
                    due: formatDate(d.due_date, lang),
                }),
            );
        } else {
            lines.push(t(lang, "summary_line", { name: d.contact_name, amount }));
        }
    }

    const total = list.reduce((s, d) => s + d.balance, 0);
    lines.push(t(lang, "summary_total", { amount: formatAmount(total, lang) }));
    return lines.join("\n");
}

/** Ochiq qarzlar matnli hisoboti: olgan / bergan + jami */
export async function showDebtSummary(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const open = await listOwnedDebts(user.id, "open");
        const borrowed = open.filter((d) => d.direction === "borrowed");
        const lent = open.filter((d) => d.direction === "lent");

        if (!borrowed.length && !lent.length) {
            await ctx.reply(t(user.language, "summary_none"), {
                reply_markup: mainReplyKeyboard(user.language),
            });
            return;
        }

        const text = [
            `<b>${t(user.language, "summary_title")}</b>`,
            "",
            formatSummarySection(user.language, "summary_borrowed", borrowed),
            "",
            formatSummarySection(user.language, "summary_lent", lent),
        ].join("\n");

        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: mainReplyKeyboard(user.language),
        });
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
        const backCallback =
            session.browseContactId && session.browseContactId === debt.contact_id
                ? `pdebts_${debt.contact_id}`
                : "list_open";

        const items = await getDebtItems(debtId);
        const preview = formatItemsPreview(user.language, items);
        let text = formatDebtCard(user.language, debt, preview);
        if (!access.isOwner) {
            const owner = await getUserById(debt.owner_id);
            text += `\n\n${t(user.language, "owned_by")}: ${owner?.first_name || "—"}`;
        }

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

export async function onCloseDebt(ctx: CTX, debtId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const access = await resolveDebtAccess(user, debtId);
        if (!access.canWrite) {
            await ctx.answerCallbackQuery({ text: t(user.language, "write_denied") }).catch(() => undefined);
            return;
        }
        await closeDebt(debtId);
        await notifyDebtClosed({ debtId, actor: user });
        await ctx.answerCallbackQuery({ text: t(user.language, "debt_closed") }).catch(() => undefined);
        await showDebtList(ctx, "open");
    } catch (error) {
        await sendErrorLog({ event: "onCloseDebt", error, ctx });
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
            scope: "debt",
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

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(`${t(user.language, "share_link_debt")}\n\n<code>${link}</code>`, {
            parse_mode: "HTML",
            reply_markup: debtDetailKeyboard(user.language, debtId, true, true),
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

export async function onShareAllNew(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const invite = await createShareInvite({
            granterId: user.id,
            scope: "all",
        });
        if (!invite.ok) {
            await ctx.answerCallbackQuery({ text: t(user.language, "no_permission") }).catch(() => undefined);
            return;
        }

        const me = await bot.api.getMe();
        const link = `https://t.me/${me.username}?start=share_${invite.token}`;

        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(`${t(user.language, "share_link_account")}\n\n<code>${link}</code>`, {
            parse_mode: "HTML",
            reply_markup: sharesListKeyboard(user.language, []),
        }).catch(async () => {
            await ctx.reply(`${t(user.language, "share_link_account")}\n\n<code>${link}</code>`, {
                parse_mode: "HTML",
                reply_markup: mainReplyKeyboard(user.language),
            });
        });
    } catch (error) {
        await sendErrorLog({ event: "onShareAllNew", error, ctx });
    }
}

export async function showSharesSettings(ctx: CTX) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;

        const outgoing = await listOutgoingAccountShares(user.id);
        const incoming = await listIncomingAccountShares(user.id);

        const items: { id: number; label: string }[] = [];

        for (const s of outgoing) {
            const grantee = s.grantee_id ? await getUserById(s.grantee_id) : null;
            const who = grantee?.first_name || (s.status === "pending" ? "⏳ pending" : "?");
            items.push({
                id: s.id,
                label: `${t(user.language, "access_granted_to")} ${who}`,
            });
        }
        for (const s of incoming) {
            const granter = await getUserById(s.granter_id);
            items.push({
                id: s.id,
                label: `${t(user.language, "access_from")} ${granter?.first_name || "?"}`,
            });
        }

        const text = `${t(user.language, "settings_shares")}\n\n${t(user.language, "share_account_hint")}${
            items.length ? "" : `\n\n${t(user.language, "access_list_empty")}`
        }`;
        await ctx.answerCallbackQuery().catch(() => undefined);
        await ctx.editMessageText(text, { reply_markup: sharesListKeyboard(user.language, items) }).catch(async () => {
            await ctx.reply(text, { reply_markup: sharesListKeyboard(user.language, items) });
        });
    } catch (error) {
        await sendErrorLog({ event: "showSharesSettings", error, ctx });
    }
}

export async function onRevokeShare(ctx: CTX, shareId: number) {
    try {
        const [user] = await saveUser(ctx);
        if (!user) return;
        const ok = await revokeShare(shareId, user.id);
        await ctx.answerCallbackQuery({
            text: ok ? t(user.language, "share_revoked") : t(user.language, "no_permission"),
        }).catch(() => undefined);
        await showSharesSettings(ctx);
    } catch (error) {
        await sendErrorLog({ event: "onRevokeShare", error, ctx });
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

        if (
            session.step === "browse_contacts" &&
            (text === t(lang, "btn_back") || text === t("uz", "btn_back") || text === t("cyrl", "btn_back"))
        ) {
            clearSession(ctx.from.id);
            await ctx.reply(t(lang, "main_menu"), { reply_markup: mainReplyKeyboard(lang) });
            return;
        }

        if (session.step === "browse_contacts") {
            const known = await listContacts(user.id);
            const matched = known.find((c) => c.name === text);
            if (matched) {
                await showContactDebts(ctx, matched.id, "open");
                return;
            }
        }

        if (session.step === "rename_contact" && session.contactId) {
            const result = await renameContact(session.contactId, user.id, text);
            if (!result.ok) {
                if (result.reason === "taken") {
                    await ctx.reply(t(lang, "contact_name_taken"), { reply_markup: cancelKeyboard(lang) });
                    return;
                }
                await ctx.reply(`${t(lang, "ask_contact")}\n${t(lang, "contact_hint")}`, {
                    reply_markup: cancelKeyboard(lang),
                });
                return;
            }

            const contactId = result.contact.id;
            await ctx.reply(t(lang, "contact_renamed", { name: result.contact.name }), {
                parse_mode: "HTML",
            });
            await showContactDebts(ctx, contactId, "open");
            return;
        }

        if (text === t(lang, "btn_skip") || text === t("uz", "btn_skip") || text === t("cyrl", "btn_skip")) {
            if (session.step === "add_due_date" && session.direction && session.contactName && session.amount) {
                const debt = await createDebt({
                    ownerId: session.asOwnerId || user.id,
                    contactName: session.contactName,
                    direction: session.direction,
                    amount: session.amount,
                    dueDate: null,
                    createdBy: user.id,
                });
                clearSession(ctx.from.id);
                await notifyDebtCreated({ debt, actor: user });
                await ctx.reply(
                    `${t(lang, "debt_created")}\n\n${formatDebtCard(lang, debt)}`,
                    { parse_mode: "HTML", reply_markup: mainReplyKeyboard(lang) },
                );
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

        if (session.step === "add_contact_name") {
            const ownerId = session.asOwnerId || user.id;

            if (text === t(lang, "contact_new") || text === t("uz", "contact_new") || text === t("cyrl", "contact_new")) {
                await ctx.reply(`${t(lang, "ask_contact_type")}\n${t(lang, "contact_hint")}`, {
                    reply_markup: cancelKeyboard(lang),
                });
                return;
            }

            const known = await listContacts(ownerId);
            const matched = known.find((c) => c.name === text);
            const contactName = matched?.name ?? text;

            if (contactName.length < 1 || contactName.length > 80) {
                await ctx.reply(t(lang, "ask_contact"));
                return;
            }

            setSession(ctx.from.id, {
                step: "add_amount",
                contactName,
                contactId: matched?.id,
                direction: session.direction,
                asOwnerId: session.asOwnerId,
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
            setSession(ctx.from.id, {
                step: "add_due_date",
                amount,
                contactName: session.contactName,
                direction: session.direction,
                asOwnerId: session.asOwnerId,
            });
            await ctx.reply(t(lang, "ask_due_date"), { reply_markup: dueDateKeyboard(lang) });
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

            const debt = await createDebt({
                ownerId: session.asOwnerId || user.id,
                contactName: session.contactName,
                direction: session.direction,
                amount: session.amount,
                dueDate: due,
                createdBy: user.id,
            });
            clearSession(ctx.from.id);
            await notifyDebtCreated({ debt, actor: user });
            await ctx.reply(`${t(lang, "debt_created")}\n\n${formatDebtCard(lang, debt)}`, {
                parse_mode: "HTML",
                reply_markup: mainReplyKeyboard(lang),
            });
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

            const debtId = session.debtId;
            const result = await addDebtItem({
                debtId,
                type: "repay",
                amount,
                createdBy: user.id,
            });
            clearSession(ctx.from.id);
            await notifyDebtItemAdded({
                debtId,
                actor: user,
                type: "repay",
                amount,
                balance: result.balance,
                closed: result.closed,
            });
            let msg = `${t(lang, "repaid")}\n${t(lang, "balance")}: ${formatAmount(result.balance, lang)}`;
            if (result.closed) msg += `\n${t(lang, "remain_zero_closed")}`;
            await ctx.reply(msg, { reply_markup: mainReplyKeyboard(lang) });
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
            const result = await addDebtItem({
                debtId: session.debtId,
                type: "charge",
                amount,
                createdBy: user.id,
            });
            clearSession(ctx.from.id);
            await notifyDebtItemAdded({
                debtId: session.debtId,
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
