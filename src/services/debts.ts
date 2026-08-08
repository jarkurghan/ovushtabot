import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { contacts, debtItems, debts, shares } from "../db/schema";
import { db } from "../db";
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
        direction: r.direction as Direction,
        status: r.status as "open" | "closed",
        linked_debt_id: r.linked_debt_id ?? null,
        balance: balances.get(r.id) ?? 0,
        initial_amount: initials.get(r.id) ?? 0,
    }));
}

async function balanceForDebtIds(debtIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!debtIds.length) return map;

    const rows = await db
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
async function firstChargeForDebtIds(debtIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (!debtIds.length) return map;

    const rows = await db
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
): Promise<DebtWithMeta[]> {
    const ids = rows.map((r) => r.id);
    const [balances, initials] = await Promise.all([balanceForDebtIds(ids), firstChargeForDebtIds(ids)]);
    return mapDebtRows(rows, balances, initials);
}

export async function getOrCreateContact(ownerId: number, name: string, linkedUserId?: number | null) {
    const trimmed = name.trim().replace(/\s+/g, " ");

    if (linkedUserId) {
        const [byLink] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.owner_id, ownerId), eq(contacts.linked_user_id, linkedUserId)))
            .limit(1);
        if (byLink) return byLink;
    }

    const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.owner_id, ownerId), eq(contacts.name, trimmed)))
        .limit(1);

    if (existing) {
        if (linkedUserId && !existing.linked_user_id) {
            const [updated] = await db
                .update(contacts)
                .set({ linked_user_id: linkedUserId })
                .where(eq(contacts.id, existing.id))
                .returning();
            return updated;
        }
        return existing;
    }

    const [created] = await db
        .insert(contacts)
        .values({
            owner_id: ownerId,
            name: trimmed,
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

export async function getContactById(contactId: number, ownerId: number) {
    const [row] = await db
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
    const trimmed = newName.trim().replace(/\s+/g, " ");
    if (trimmed.length < 1 || trimmed.length > 80) {
        return { ok: false, reason: "invalid" };
    }

    const contact = await getContactById(contactId, ownerId);
    if (!contact) return { ok: false, reason: "not_found" };
    if (contact.name === trimmed) return { ok: true, contact };

    const [dup] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.owner_id, ownerId), eq(contacts.name, trimmed)))
        .limit(1);
    if (dup) return { ok: false, reason: "taken" };

    const [updated] = await db
        .update(contacts)
        .set({ name: trimmed })
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
        name: c.name,
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

export async function createDebt(params: {
    ownerId: number;
    contactName: string;
    direction: Direction;
    amount: number;
    dueDate?: string | null;
    createdBy: number;
}): Promise<DebtWithMeta> {
    const contact = await getOrCreateContact(params.ownerId, params.contactName);

    const [debt] = await db
        .insert(debts)
        .values({
            owner_id: params.ownerId,
            contact_id: contact.id,
            direction: params.direction,
            due_date: params.dueDate || null,
            status: "open",
        })
        .returning();

    await db.insert(debtItems).values({
        debt_id: debt.id,
        type: "charge",
        amount: params.amount,
        created_by: params.createdBy,
        note: null,
    });

    return {
        id: debt.id,
        owner_id: debt.owner_id,
        contact_id: contact.id,
        contact_name: contact.name,
        direction: debt.direction as Direction,
        due_date: debt.due_date,
        status: debt.status as "open" | "closed",
        note: debt.note,
        linked_debt_id: debt.linked_debt_id ?? null,
        balance: params.amount,
        initial_amount: params.amount,
        created_at: debt.created_at,
    };
}

export async function addDebtItem(params: {
    debtId: number;
    type: "charge" | "repay";
    amount: number;
    createdBy: number;
    note?: string | null;
    /** Twin ga qayta sync qilmaslik (loop oldini olish) */
    skipTwinSync?: boolean;
}): Promise<{ balance: number; closed: boolean }> {
    await db.insert(debtItems).values({
        debt_id: params.debtId,
        type: params.type,
        amount: params.amount,
        created_by: params.createdBy,
        note: params.note || null,
    });

    const balances = await balanceForDebtIds([params.debtId]);
    const balance = balances.get(params.debtId) ?? 0;

    let closed = false;
    if (balance <= 0) {
        await db.update(debts).set({ status: "closed" }).where(eq(debts.id, params.debtId));
        closed = true;
    } else {
        await db.update(debts).set({ status: "open" }).where(eq(debts.id, params.debtId));
    }

    if (!params.skipTwinSync) {
        const [row] = await db.select({ linked_debt_id: debts.linked_debt_id }).from(debts).where(eq(debts.id, params.debtId)).limit(1);
        if (row?.linked_debt_id) {
            await addDebtItem({
                debtId: row.linked_debt_id,
                type: params.type,
                amount: params.amount,
                createdBy: params.createdBy,
                note: params.note,
                skipTwinSync: true,
            });
        }
    }

    return { balance: Math.max(balance, 0), closed };
}

export async function setDueDate(debtId: number, dueDate: string | null, skipTwinSync = false) {
    await db.update(debts).set({ due_date: dueDate }).where(eq(debts.id, debtId));
    if (!skipTwinSync) {
        const [row] = await db.select({ linked_debt_id: debts.linked_debt_id }).from(debts).where(eq(debts.id, debtId)).limit(1);
        if (row?.linked_debt_id) {
            await setDueDate(row.linked_debt_id, dueDate, true);
        }
    }
}

export async function closeDebt(debtId: number, skipTwinSync = false) {
    await db.update(debts).set({ status: "closed" }).where(eq(debts.id, debtId));
    if (!skipTwinSync) {
        const [row] = await db.select({ linked_debt_id: debts.linked_debt_id }).from(debts).where(eq(debts.id, debtId)).limit(1);
        if (row?.linked_debt_id) {
            await closeDebt(row.linked_debt_id, true);
        }
    }
}

export async function getDebtById(debtId: number): Promise<DebtWithMeta | null> {
    const [row] = await db
        .select(debtSelect)
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(eq(debts.id, debtId))
        .limit(1);

    if (!row) return null;
    return (await enrichDebtRows([row]))[0] ?? null;
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

async function activeSharesForUser(userId: number) {
    return db
        .select()
        .from(shares)
        .where(and(eq(shares.grantee_id, userId), eq(shares.status, "active")));
}

export type DebtAccess = {
    canView: boolean;
    canWrite: boolean;
    isOwner: boolean;
};

export async function resolveDebtAccess(user: User, debtId: number): Promise<DebtAccess> {
    const debt = await getDebtById(debtId);
    if (!debt) return { canView: false, canWrite: false, isOwner: false };

    if (debt.owner_id === user.id) {
        return { canView: true, canWrite: true, isOwner: true };
    }

    const userShares = await activeSharesForUser(user.id);

    for (const s of userShares) {
        if (s.granter_id !== debt.owner_id) continue;

        let matches = false;
        if (s.scope === "all") matches = true;
        if (s.scope === "contact" && s.contact_id === debt.contact_id) matches = true;
        if (s.scope === "debt" && s.debt_id === debt.id) matches = true;

        // Account ulashish — full access (debt-share twin orqali isOwner bo'ladi)
        if (matches && s.scope === "all") return { canView: true, canWrite: true, isOwner: false };
        if (matches && s.scope !== "debt") return { canView: true, canWrite: true, isOwner: false };
    }

    return { canView: false, canWrite: false, isOwner: false };
}

/** Account ulashish (scope=all) — faol kiruvchi */
export async function listIncomingAccountShares(granteeId: number) {
    return db
        .select()
        .from(shares)
        .where(and(eq(shares.grantee_id, granteeId), eq(shares.status, "active"), eq(shares.scope, "all")))
        .orderBy(desc(shares.created_at));
}

export async function listOutgoingAccountShares(granterId: number) {
    return db
        .select()
        .from(shares)
        .where(
            and(
                eq(shares.granter_id, granterId),
                inArray(shares.status, ["pending", "active"]),
                eq(shares.scope, "all"),
            ),
        )
        .orderBy(desc(shares.created_at));
}

export async function createShareInvite(params: {
    granterId: number;
    scope: "all" | "debt";
    debtId?: number;
}): Promise<{ ok: true; token: string; id: number } | { ok: false; error: "already_linked" | "not_found" }> {
    if (params.scope === "debt" && params.debtId) {
        const debt = await getDebtById(params.debtId);
        if (!debt || debt.owner_id !== params.granterId) {
            return { ok: false, error: "not_found" };
        }
        if (debt.linked_debt_id) {
            return { ok: false, error: "already_linked" };
        }
    }

    const token = crypto.randomUUID().replaceAll("-", "");

    const [row] = await db
        .insert(shares)
        .values({
            granter_id: params.granterId,
            scope: params.scope,
            access: "write",
            contact_id: null,
            debt_id: params.debtId ?? null,
            invite_token: token,
            status: "pending",
        })
        .returning();

    return { ok: true, token, id: row.id };
}

export async function acceptShareInvite(token: string, granteeId: number) {
    const [share] = await db.select().from(shares).where(eq(shares.invite_token, token)).limit(1);
    if (!share || share.status === "revoked") return null;
    if (share.granter_id === granteeId) return null;

    // Debt share → twin debt (grantee o'z Qarzlarimida ko'radi)
    if (share.scope === "debt" && share.debt_id) {
        const { ensureTwinDebt } = await import("./debt-link");
        await ensureTwinDebt(share.debt_id, granteeId);
    }

    const [updated] = await db
        .update(shares)
        .set({
            grantee_id: granteeId,
            status: "active",
            invite_token: null,
        })
        .where(eq(shares.id, share.id))
        .returning();

    return updated;
}

export async function listOutgoingShares(granterId: number) {
    return db
        .select()
        .from(shares)
        .where(and(eq(shares.granter_id, granterId), inArray(shares.status, ["pending", "active"])))
        .orderBy(desc(shares.created_at));
}

export async function listIncomingShares(granteeId: number) {
    return db
        .select()
        .from(shares)
        .where(and(eq(shares.grantee_id, granteeId), eq(shares.status, "active")))
        .orderBy(desc(shares.created_at));
}

export async function revokeShare(shareId: number, actorId: number) {
    const [share] = await db.select().from(shares).where(eq(shares.id, shareId)).limit(1);
    if (!share) return false;
    if (share.granter_id !== actorId && share.grantee_id !== actorId) return false;

    await db.update(shares).set({ status: "revoked" }).where(eq(shares.id, shareId));
    return true;
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

/** Account managerlar (+ twin owner alohida party-notify da) */
export async function listActiveGranteesForDebt(debt: DebtWithMeta): Promise<{ userId: number }[]> {
    const rows = await db
        .select()
        .from(shares)
        .where(and(eq(shares.granter_id, debt.owner_id), eq(shares.status, "active"), eq(shares.scope, "all")));

    const result: { userId: number }[] = [];
    for (const s of rows) {
        if (s.grantee_id) result.push({ userId: s.grantee_id });
    }
    return result;
}
