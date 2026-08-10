import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { contacts, debtItems, debts, shares } from "../db/schema";
import { db, runInTransaction, type DbExecutor } from "../db";
import { formatContactName, normalizeContactName, contactNameHasForbiddenChars } from "../utils/format";
import type { Direction, User } from "../utils/types";

export type DebtWithMeta = {
    id: number;
    owner_id: number;
    contact_id: number;
    contact_name: string;
    direction: Direction;
    due_date: string | null;
    status: "open" | "closed";
    note: string | null;
    linked_debt_id: number | null;
    balance: number;
    /** Birinchi charge summasi (arxiv ro'yxati uchun) */
    initial_amount: number;
    created_at: Date;
};

export type DebtItemRow = typeof debtItems.$inferSelect;

const debtSelect = {
    id: debts.id,
    owner_id: debts.owner_id,
    contact_id: debts.contact_id,
    contact_name: contacts.name,
    direction: debts.direction,
    due_date: debts.due_date,
    status: debts.status,
    note: debts.note,
    linked_debt_id: debts.linked_debt_id,
    created_at: debts.created_at,
};

function mapDebtRows(
    rows: Array<{
        id: number;
        owner_id: number;
        contact_id: number;
        contact_name: string;
        direction: string;
        due_date: string | null;
        status: string;
        note: string | null;
        linked_debt_id: number | null;
        created_at: Date;
    }>,
    balances: Map<number, number>,
    initials: Map<number, number>,
): DebtWithMeta[] {
    return rows.map((r) => ({
        ...r,
        contact_name: formatContactName(r.contact_name),
        direction: r.direction as Direction,
        status: r.status as "open" | "closed",
        linked_debt_id: r.linked_debt_id ?? null,
        balance: balances.get(r.id) ?? 0,
        initial_amount: initials.get(r.id) ?? 0,
    }));
}

async function balanceForDebtIds(debtIds: number[], exec: DbExecutor = db): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!debtIds.length) return map;

    const rows = await exec
        .select({
            debt_id: debtItems.debt_id,
            balance: sql<number>`coalesce(sum(case when ${debtItems.type} = 'charge' then ${debtItems.amount} else -${debtItems.amount} end), 0)`.mapWith(Number),
        })
        .from(debtItems)
        .where(inArray(debtItems.debt_id, debtIds))
        .groupBy(debtItems.debt_id);

    for (const row of rows) map.set(row.debt_id, row.balance);
    return map;
}

/** Har bir qarzning eng birinchi charge summasi */
async function firstChargeForDebtIds(debtIds: number[], exec: DbExecutor = db): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!debtIds.length) return map;

    const rows = await exec
        .select({
            debt_id: debtItems.debt_id,
            amount: debtItems.amount,
        })
        .from(debtItems)
        .where(and(inArray(debtItems.debt_id, debtIds), eq(debtItems.type, "charge")))
        .orderBy(asc(debtItems.created_at), asc(debtItems.id));

    for (const row of rows) {
        if (!map.has(row.debt_id)) map.set(row.debt_id, row.amount);
    }
    return map;
}

async function enrichDebtRows(
    rows: Array<{
        id: number;
        owner_id: number;
        contact_id: number;
        contact_name: string;
        direction: string;
        due_date: string | null;
        status: string;
        note: string | null;
        linked_debt_id: number | null;
        created_at: Date;
    }>,
    exec: DbExecutor = db,
): Promise<DebtWithMeta[]> {
    const ids = rows.map((r) => r.id);
    const [balances, initials] = await Promise.all([
        balanceForDebtIds(ids, exec),
        firstChargeForDebtIds(ids, exec),
    ]);
    return mapDebtRows(rows, balances, initials);
}

export async function getOrCreateContact(
    ownerId: number,
    name: string,
    linkedUserId?: number | null,
    exec: DbExecutor = db,
) {
    const stored = normalizeContactName(name);

    if (linkedUserId) {
        const [byLink] = await exec
            .select()
            .from(contacts)
            .where(and(eq(contacts.owner_id, ownerId), eq(contacts.linked_user_id, linkedUserId)))
            .limit(1);
        if (byLink) return byLink;
    }

    const [existing] = await exec
        .select()
        .from(contacts)
        .where(and(eq(contacts.owner_id, ownerId), eq(contacts.name, stored)))
        .limit(1);

    if (existing) {
        if (linkedUserId && !existing.linked_user_id) {
            const [updated] = await exec
                .update(contacts)
                .set({ linked_user_id: linkedUserId })
                .where(eq(contacts.id, existing.id))
                .returning();
            return updated;
        }
        return existing;
    }

    const [created] = await exec
        .insert(contacts)
        .values({
            owner_id: ownerId,
            name: stored,
            linked_user_id: linkedUserId ?? null,
        })
        .returning();
    return created;
}

export async function listContacts(ownerId: number) {
    return db
        .select()
        .from(contacts)
        .where(eq(contacts.owner_id, ownerId))
        .orderBy(contacts.name);
}

/** Kontakt bo'yicha ochiq qarzlar jami balansi */
async function openBalanceByContactIds(ownerId: number, contactIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!contactIds.length) return map;

    const openRows = await db
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(
            and(
                eq(debts.owner_id, ownerId),
                eq(debts.status, "open"),
                inArray(debts.contact_id, contactIds),
            ),
        );
    const enriched = await enrichDebtRows(openRows);
    for (const d of enriched) {
        map.set(d.contact_id, (map.get(d.contact_id) ?? 0) + Math.max(d.balance, 0));
    }
    return map;
}

/** Shu kontakt bilan aktiv (ochiq, balans > 0) qarz bormi */
export async function contactHasActiveDebt(ownerId: number, contactId: number): Promise<boolean> {
    const balances = await openBalanceByContactIds(ownerId, [contactId]);
    return (balances.get(contactId) ?? 0) > 0;
}

/** Yangi/qayta ochilgan qarzda «ovushmayman» avtomatik o'chadi */
export async function clearHideWhenZeroForContact(
    contactId: number,
    exec: DbExecutor = db,
): Promise<void> {
    await exec
        .update(contacts)
        .set({ hide_when_zero: false })
        .where(and(eq(contacts.id, contactId), eq(contacts.hide_when_zero, true)));
}

/**
 * Qarz qo'shishdagi tanlash ro'yxati:
 * hide_when_zero=true va ochiq qarz jami <= 0 bo'lsa chiqarilmaydi.
 */
export async function listContactsForPicker(ownerId: number) {
    const known = await listContacts(ownerId);
    if (!known.length) return [];

    const needFilter = known.filter((c) => c.hide_when_zero);
    if (!needFilter.length) return known;

    const balances = await openBalanceByContactIds(
        ownerId,
        needFilter.map((c) => c.id),
    );

    return known.filter((c) => {
        if (!c.hide_when_zero) return true;
        return (balances.get(c.id) ?? 0) > 0;
    });
}

export async function setContactHideWhenZero(
    contactId: number,
    ownerId: number,
    hideWhenZero: boolean,
): Promise<{ ok: true; contact: typeof contacts.$inferSelect } | { ok: false; reason: "not_found" | "has_active" }> {
    const contact = await getContactById(contactId, ownerId);
    if (!contact) return { ok: false, reason: "not_found" };

    if (hideWhenZero) {
        const active = await contactHasActiveDebt(ownerId, contactId);
        if (active) return { ok: false, reason: "has_active" };
    }

    const [updated] = await db
        .update(contacts)
        .set({ hide_when_zero: hideWhenZero })
        .where(and(eq(contacts.id, contactId), eq(contacts.owner_id, ownerId)))
        .returning();
    if (!updated) return { ok: false, reason: "not_found" };
    return { ok: true, contact: updated };
}

export async function getContactById(contactId: number, ownerId: number, exec: DbExecutor = db) {
    const [row] = await exec
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.owner_id, ownerId)))
        .limit(1);
    return row ?? null;
}

export type RenameContactResult =
    | { ok: true; contact: typeof contacts.$inferSelect }
    | { ok: false; reason: "not_found" | "taken" | "invalid" };

export async function renameContact(
    contactId: number,
    ownerId: number,
    newName: string,
): Promise<RenameContactResult> {
    if (contactNameHasForbiddenChars(newName)) {
        return { ok: false, reason: "invalid" };
    }
    const stored = normalizeContactName(newName);
    if (stored.length < 1 || stored.length > 80) {
        return { ok: false, reason: "invalid" };
    }

    const contact = await getContactById(contactId, ownerId);
    if (!contact) return { ok: false, reason: "not_found" };
    if (contact.name === stored) return { ok: true, contact };

    const [dup] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.owner_id, ownerId), eq(contacts.name, stored)))
        .limit(1);
    if (dup) return { ok: false, reason: "taken" };

    const [updated] = await db
        .update(contacts)
        .set({ name: stored })
        .where(and(eq(contacts.id, contactId), eq(contacts.owner_id, ownerId)))
        .returning();

    if (!updated) return { ok: false, reason: "not_found" };
    return { ok: true, contact: updated };
}

export type ContactSummary = {
    id: number;
    name: string;
    borrowedBalance: number;
    lentBalance: number;
    openCount: number;
};

/** Tanishlar + tarixdagi jami (barcha charge'lar yig'indisi, ochiq/yopiq) */
export async function listContactSummaries(ownerId: number): Promise<ContactSummary[]> {
    const known = await listContacts(ownerId);
    if (!known.length) return [];

    const totals = await db
        .select({
            contact_id: debts.contact_id,
            direction: debts.direction,
            total: sql<number>`coalesce(sum(case when ${debtItems.type} = 'charge' then ${debtItems.amount} else 0 end), 0)`.mapWith(
                Number,
            ),
        })
        .from(debts)
        .leftJoin(debtItems, eq(debtItems.debt_id, debts.id))
        .where(eq(debts.owner_id, ownerId))
        .groupBy(debts.contact_id, debts.direction);

    const openCounts = await db
        .select({
            contact_id: debts.contact_id,
            count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(debts)
        .where(and(eq(debts.owner_id, ownerId), eq(debts.status, "open")))
        .groupBy(debts.contact_id);

    const borrowedByContact = new Map<number, number>();
    const lentByContact = new Map<number, number>();
    for (const row of totals) {
        if (row.direction === "borrowed") borrowedByContact.set(row.contact_id, row.total);
        else if (row.direction === "lent") lentByContact.set(row.contact_id, row.total);
    }
    const openByContact = new Map(openCounts.map((r) => [r.contact_id, r.count]));

    return known.map((c) => ({
        id: c.id,
        name: formatContactName(c.name),
        borrowedBalance: borrowedByContact.get(c.id) ?? 0,
        lentBalance: lentByContact.get(c.id) ?? 0,
        openCount: openByContact.get(c.id) ?? 0,
    }));
}

export async function listDebtsByContact(
    ownerId: number,
    contactId: number,
    status: "open" | "closed" = "open",
): Promise<DebtWithMeta[]> {
    const rows = await db
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(eq(debts.owner_id, ownerId), eq(debts.contact_id, contactId), eq(debts.status, status)))
        .orderBy(desc(debts.updated_at));

    return enrichDebtRows(rows);
}

/** Kontakt avval ulashilgan bo'lsa — linked user; yo'q bo'lsa eski twin dan tiklaydi */
async function resolveContactLinkedUserId(
    contact: typeof contacts.$inferSelect,
    exec: DbExecutor = db,
): Promise<number | null> {
    if (contact.linked_user_id) return contact.linked_user_id;

    const [row] = await exec
        .select({ linked_debt_id: debts.linked_debt_id })
        .from(debts)
        .where(and(eq(debts.contact_id, contact.id), sql`${debts.linked_debt_id} is not null`))
        .orderBy(desc(debts.updated_at))
        .limit(1);

    if (!row?.linked_debt_id) return null;

    const twin = await getDebtById(row.linked_debt_id, exec);
    if (!twin) return null;

    await exec.update(contacts).set({ linked_user_id: twin.owner_id }).where(eq(contacts.id, contact.id));
    return twin.owner_id;
}

export type CreateDebtResult = {
    debt: DebtWithMeta;
    /** Mavjud ochiq qarzga qo'shildi (bir xil yo'nalish) yoki qaytarish (teskari) */
    merged: boolean;
    /** bir xil → charge; teskari → repay (+ qolgan summa yangi yo'nalishda) */
    mergeType?: "charge" | "repay" | "net";
    amount: number;
    closed?: boolean;
    /** Teskari qarzdan keyin qolgan summa uchun ochilgan qarz */
    remainderDebt?: DebtWithMeta;
    remainderAmount?: number;
    /** Net paytda qaytarish bo'lgan eski qarz id */
    settledDebtId?: number;
};

function flipDirection(direction: Direction): Direction {
    return direction === "borrowed" ? "lent" : "borrowed";
}

/**
 * Shu tanish + SHU yo'nalishdagi ochiq qarz (merge uchun).
 * Teskari yo'nalish (oldim vs berdim) hech qachon birlashtirilmaydi.
 */
export async function findOpenDebtId(
    ownerId: number,
    contactName: string,
    direction: Direction,
    contactId?: number | null,
    exec: DbExecutor = db,
): Promise<number | null> {
    const needle = normalizeContactName(contactName);

    const ownerContacts = await exec.select().from(contacts).where(eq(contacts.owner_id, ownerId));

    const matched = ownerContacts.filter(
        (c) => c.id === contactId || normalizeContactName(c.name) === needle,
    );

    const contactIds = new Set(matched.map((c) => c.id));
    const peerIds = new Set(
        matched.map((c) => c.linked_user_id).filter((id): id is number => id != null && id !== ownerId),
    );

    for (const c of matched) {
        if (c.linked_user_id) continue;
        const peer = await resolveContactLinkedUserId(c, exec);
        if (peer && peer !== ownerId) peerIds.add(peer);
    }

    for (const c of ownerContacts) {
        if (c.linked_user_id && peerIds.has(c.linked_user_id)) contactIds.add(c.id);
    }

    if (contactIds.size > 0) {
        const [sameDir] = await exec
            .select({ id: debts.id })
            .from(debts)
            .where(
                and(
                    eq(debts.owner_id, ownerId),
                    eq(debts.status, "open"),
                    eq(debts.direction, direction),
                    inArray(debts.contact_id, [...contactIds]),
                ),
            )
            .orderBy(desc(debts.updated_at))
            .limit(1);
        if (sameDir) return sameDir.id;
    }

    // Peer twin orqali — faqat o'z tomonda shu yo'nalishdagi juft
    for (const peerUserId of peerIds) {
        const [oursDirect] = await exec
            .select({ id: debts.id })
            .from(debts)
            .innerJoin(contacts, eq(contacts.id, debts.contact_id))
            .where(
                and(
                    eq(debts.owner_id, ownerId),
                    eq(debts.status, "open"),
                    eq(debts.direction, direction),
                    eq(contacts.linked_user_id, peerUserId),
                ),
            )
            .orderBy(desc(debts.updated_at))
            .limit(1);
        if (oursDirect) return oursDirect.id;

        const peerOpenRows = await exec
            .select({ linked_debt_id: debts.linked_debt_id })
            .from(debts)
            .innerJoin(contacts, eq(contacts.id, debts.contact_id))
            .where(
                and(
                    eq(debts.owner_id, peerUserId),
                    eq(debts.status, "open"),
                    eq(debts.direction, flipDirection(direction)),
                    eq(contacts.linked_user_id, ownerId),
                ),
            )
            .orderBy(desc(debts.updated_at));

        for (const peerDebt of peerOpenRows) {
            if (!peerDebt.linked_debt_id) continue;
            const ours = await getDebtById(peerDebt.linked_debt_id, exec);
            if (ours && ours.owner_id === ownerId && ours.direction === direction) {
                return ours.id;
            }
        }
    }

    return null;
}

export async function createDebt(params: {
    ownerId: number;
    contactName: string;
    direction: Direction;
    amount: number;
    dueDate?: string | null;
    createdBy: number;
    contactId?: number | null;
    note?: string | null;
    /** Nested chaqiriq (repayDebt va h.k.) uchun mavjud transaction */
    exec?: DbExecutor;
}): Promise<CreateDebtResult> {
    return runInTransaction(async (tx) => {
        const itemNote = params.note?.trim() ? params.note.trim() : null;
        const contact = params.contactId
            ? ((await getContactById(params.contactId, params.ownerId, tx)) ??
              (await getOrCreateContact(params.ownerId, params.contactName, null, tx)))
            : await getOrCreateContact(params.ownerId, params.contactName, null, tx);

        // Bir xil yo'nalishdagi ochiq qarz → charge; teskari ochiq qarz → repay (yangisi ochilmaydi)
        const sameDirId = await findOpenDebtId(
            params.ownerId,
            params.contactName,
            params.direction,
            contact.id,
            tx,
        );
        const oppositeDirId = sameDirId
            ? null
            : await findOpenDebtId(
                  params.ownerId,
                  params.contactName,
                  flipDirection(params.direction),
                  contact.id,
                  tx,
              );

        const createFresh = async (amount: number, dueDate?: string | null): Promise<DebtWithMeta> => {
            const [debt] = await tx
                .insert(debts)
                .values({
                    owner_id: params.ownerId,
                    contact_id: contact.id,
                    direction: params.direction,
                    due_date: dueDate || null,
                    status: "open",
                })
                .returning();

            await tx.insert(debtItems).values({
                debt_id: debt.id,
                type: "charge",
                amount,
                created_by: params.createdBy,
                note: itemNote,
            });
            await clearHideWhenZeroForContact(contact.id, tx);

            const peerUserId = await resolveContactLinkedUserId(contact, tx);
            if (peerUserId && peerUserId !== params.ownerId) {
                const { ensureTwinDebt } = await import("./debt-link");
                await ensureTwinDebt(debt.id, peerUserId, tx);
            }

            const created = await getDebtById(debt.id, tx);
            if (!created) throw new Error("createDebt: fresh debt missing");
            return created;
        };

        if (sameDirId) {
            const existing = await getDebtById(sameDirId, tx);
            if (!existing) throw new Error("createDebt merge: debt missing");
            if (existing.status === "closed") {
                await tx.update(debts).set({ status: "open" }).where(eq(debts.id, sameDirId));
            }
            await addDebtItem({
                debtId: sameDirId,
                type: "charge",
                amount: params.amount,
                createdBy: params.createdBy,
                note: itemNote,
                exec: tx,
            });
            if (params.dueDate) {
                await setDueDate(sameDirId, params.dueDate, false, tx);
            }
            const debt = await getDebtById(sameDirId, tx);
            if (!debt) throw new Error("createDebt merge: debt missing after charge");
            return { debt, merged: true, mergeType: "charge", amount: params.amount };
        }

        if (oppositeDirId) {
            // Teskari yo'nalish: avval eski qarzdan qaytarish, ortiqcha bo'lsa yangi yo'nalishda qarz
            const existing = await getDebtById(oppositeDirId, tx);
            if (!existing) throw new Error("createDebt opposite: debt missing");
            const bal = existing.balance > 0 ? existing.balance : 0;
            const repayAmount = Math.min(params.amount, bal);
            const remainder = params.amount - repayAmount;

            let closed = false;
            if (repayAmount > 0) {
                const result = await addDebtItem({
                    debtId: oppositeDirId,
                    type: "repay",
                    amount: repayAmount,
                    createdBy: params.createdBy,
                    note: itemNote,
                    exec: tx,
                });
                closed = result.closed;
            }

            const afterRepay = await getDebtById(oppositeDirId, tx);
            if (!afterRepay) throw new Error("createDebt opposite: debt missing after repay");

            if (remainder > 0) {
                const remainderDebt = await createFresh(remainder, params.dueDate ?? null);
                return {
                    debt: remainderDebt,
                    merged: true,
                    mergeType: "net",
                    amount: repayAmount,
                    closed,
                    remainderDebt,
                    remainderAmount: remainder,
                    settledDebtId: oppositeDirId,
                };
            }

            return {
                debt: afterRepay,
                merged: true,
                mergeType: "repay",
                amount: repayAmount,
                closed,
                settledDebtId: oppositeDirId,
            };
        }

        const created = await createFresh(params.amount, params.dueDate ?? null);
        return { debt: created, merged: false, amount: params.amount };
    }, params.exec);
}

export async function addDebtItem(params: {
    debtId: number;
    type: "charge" | "repay";
    amount: number;
    createdBy: number;
    note?: string | null;
    /** Twin ga qayta sync qilmaslik (loop oldini olish) */
    skipTwinSync?: boolean;
    exec?: DbExecutor;
}): Promise<{ balance: number; closed: boolean }> {
    return runInTransaction(async (tx) => {
        await tx.insert(debtItems).values({
            debt_id: params.debtId,
            type: params.type,
            amount: params.amount,
            created_by: params.createdBy,
            note: params.note || null,
        });

        if (params.type === "charge") {
            const [debtRow] = await tx
                .select({ contact_id: debts.contact_id })
                .from(debts)
                .where(eq(debts.id, params.debtId))
                .limit(1);
            if (debtRow) await clearHideWhenZeroForContact(debtRow.contact_id, tx);
        }

        const balances = await balanceForDebtIds([params.debtId], tx);
        const balance = balances.get(params.debtId) ?? 0;

        let closed = false;
        if (balance <= 0) {
            await tx.update(debts).set({ status: "closed" }).where(eq(debts.id, params.debtId));
            closed = true;
        } else {
            await tx.update(debts).set({ status: "open" }).where(eq(debts.id, params.debtId));
        }

        if (!params.skipTwinSync) {
            const [row] = await tx
                .select({ linked_debt_id: debts.linked_debt_id })
                .from(debts)
                .where(eq(debts.id, params.debtId))
                .limit(1);
            if (row?.linked_debt_id) {
                await addDebtItem({
                    debtId: row.linked_debt_id,
                    type: params.type,
                    amount: params.amount,
                    createdBy: params.createdBy,
                    note: params.note,
                    skipTwinSync: true,
                    exec: tx,
                });
            }
        }

        return { balance: Math.max(balance, 0), closed };
    }, params.exec);
}

export type RepayDebtResult = {
    repayAmount: number;
    balance: number;
    closed: boolean;
    debtId: number;
    remainderDebt?: DebtWithMeta;
    remainderAmount?: number;
    /** createDebt natijasi — notify uchun */
    remainderCreate?: CreateDebtResult;
};

/** Qaytarish: balansdan ortiq bo'lsa teskari yo'nalishda yangi qarz */
export async function repayDebt(params: {
    debtId: number;
    amount: number;
    createdBy: number;
    ownerId: number;
    note?: string | null;
    exec?: DbExecutor;
}): Promise<RepayDebtResult> {
    return runInTransaction(async (tx) => {
        const debt = await getDebtById(params.debtId, tx);
        if (!debt) throw new Error("repayDebt: debt missing");

        const bal = debt.balance > 0 ? debt.balance : 0;
        const repayAmount = Math.min(params.amount, bal);
        const remainder = params.amount - repayAmount;

        let balance = bal;
        let closed = bal <= 0;

        if (repayAmount > 0) {
            const result = await addDebtItem({
                debtId: params.debtId,
                type: "repay",
                amount: repayAmount,
                createdBy: params.createdBy,
                note: params.note,
                exec: tx,
            });
            balance = result.balance;
            closed = result.closed;
        }

        if (remainder <= 0) {
            return { repayAmount, balance, closed, debtId: params.debtId };
        }

        const remainderCreate = await createDebt({
            ownerId: params.ownerId,
            contactName: debt.contact_name,
            contactId: debt.contact_id,
            direction: flipDirection(debt.direction),
            amount: remainder,
            dueDate: null,
            createdBy: params.createdBy,
            note: params.note,
            exec: tx,
        });

        return {
            repayAmount,
            balance,
            closed,
            debtId: params.debtId,
            remainderAmount: remainder,
            remainderDebt: remainderCreate.remainderDebt ?? remainderCreate.debt,
            remainderCreate,
        };
    }, params.exec);
}

export async function setDueDate(
    debtId: number,
    dueDate: string | null,
    skipTwinSync = false,
    exec?: DbExecutor,
) {
    return runInTransaction(async (tx) => {
        await tx.update(debts).set({ due_date: dueDate }).where(eq(debts.id, debtId));
        if (!skipTwinSync) {
            const [row] = await tx
                .select({ linked_debt_id: debts.linked_debt_id })
                .from(debts)
                .where(eq(debts.id, debtId))
                .limit(1);
            if (row?.linked_debt_id) {
                await setDueDate(row.linked_debt_id, dueDate, true, tx);
            }
        }
    }, exec);
}

export async function getDebtById(debtId: number, exec: DbExecutor = db): Promise<DebtWithMeta | null> {
    const [row] = await exec
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(eq(debts.id, debtId))
        .limit(1);

    if (!row) return null;
    return (await enrichDebtRows([row], exec))[0] ?? null;
}

export async function getDebtItems(debtId: number): Promise<DebtItemRow[]> {
    return db.select().from(debtItems).where(eq(debtItems.debt_id, debtId)).orderBy(desc(debtItems.created_at));
}

/** Ownerning ochiq/yopiq qarzlari */
export async function listOwnedDebts(
    ownerId: number,
    status: "open" | "closed" = "open",
    direction?: Direction,
): Promise<DebtWithMeta[]> {
    const conditions = [eq(debts.owner_id, ownerId), eq(debts.status, status)];
    if (direction) conditions.push(eq(debts.direction, direction));

    const rows = await db
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(...conditions))
        .orderBy(desc(debts.updated_at));

    return enrichDebtRows(rows);
}

export type DebtAccess = {
    canView: boolean;
    canWrite: boolean;
    isOwner: boolean;
};

/** Faqat qarz egasi (twin egasi o'z debtiga owner) */
export async function resolveDebtAccess(user: User, debtId: number): Promise<DebtAccess> {
    const debt = await getDebtById(debtId);
    if (!debt) return { canView: false, canWrite: false, isOwner: false };

    if (debt.owner_id === user.id) {
        return { canView: true, canWrite: true, isOwner: true };
    }

    return { canView: false, canWrite: false, isOwner: false };
}

export async function createShareInvite(params: {
    granterId: number;
    debtId: number;
}): Promise<{ ok: true; token: string; id: number } | { ok: false; error: "already_linked" | "not_found" }> {
    return runInTransaction(async (tx) => {
        const debt = await getDebtById(params.debtId, tx);
        if (!debt || debt.owner_id !== params.granterId) {
            return { ok: false, error: "not_found" };
        }
        if (debt.linked_debt_id) {
            return { ok: false, error: "already_linked" };
        }

        // Yangi havola — shu qarzdagi eski pending takliflar bekor (eski link ishlamaydi)
        await tx
            .update(shares)
            .set({ status: "revoked", invite_token: null })
            .where(
                and(
                    eq(shares.debt_id, params.debtId),
                    eq(shares.scope, "debt"),
                    eq(shares.status, "pending"),
                ),
            );

        const token = crypto.randomUUID().replaceAll("-", "");

        const [row] = await tx
            .insert(shares)
            .values({
                granter_id: params.granterId,
                scope: "debt",
                access: "write",
                contact_id: null,
                debt_id: params.debtId,
                invite_token: token,
                status: "pending",
            })
            .returning();

        return { ok: true, token, id: row.id };
    });
}

export async function acceptShareInvite(token: string, granteeId: number) {
    return runInTransaction(async (tx) => {
        const [share] = await tx
            .select()
            .from(shares)
            .where(eq(shares.invite_token, token))
            .for("update")
            .limit(1);
        if (!share || share.status === "revoked") return null;
        if (share.granter_id === granteeId) return null;
        // Faqat qarz ulashish (account scope=all endi qabul qilinmaydi)
        if (share.scope !== "debt" || !share.debt_id) return null;

        const { ensureTwinDebt } = await import("./debt-link");
        const twin = await ensureTwinDebt(share.debt_id, granteeId, tx);
        // Twin yaratilmasa — share ham active bo'lmasin (atomik)
        if (!twin) return null;

        const [updated] = await tx
            .update(shares)
            .set({
                grantee_id: granteeId,
                status: "active",
                invite_token: null,
            })
            .where(eq(shares.id, share.id))
            .returning();

        return updated;
    });
}

/** Due date bo'yicha ochiq qarzlar (scheduler) */
export async function listDebtsDueOn(dateIso: string): Promise<DebtWithMeta[]> {
    const rows = await db
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(eq(debts.status, "open"), eq(debts.due_date, dateIso)));

    return enrichDebtRows(rows);
}

