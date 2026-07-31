import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
    balance: number;
    created_at: Date;
};

export type DebtItemRow = typeof debtItems.$inferSelect;

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

export async function getOrCreateContact(ownerId: number, name: string) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.owner_id, ownerId), eq(contacts.name, trimmed)))
        .limit(1);

    if (existing) return existing;

    const [created] = await db
        .insert(contacts)
        .values({ owner_id: ownerId, name: trimmed })
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

export type ContactSummary = {
    id: number;
    name: string;
    borrowedBalance: number;
    lentBalance: number;
    openCount: number;
};

/** Tanishlar + ochiq qarz qoldiqlari */
export async function listContactSummaries(ownerId: number): Promise<ContactSummary[]> {
    const known = await listContacts(ownerId);
    if (!known.length) return [];

    const openDebts = await listOwnedDebts(ownerId, "open");
    return known.map((c) => {
        const related = openDebts.filter((d) => d.contact_id === c.id);
        return {
            id: c.id,
            name: c.name,
            borrowedBalance: related.filter((d) => d.direction === "borrowed").reduce((s, d) => s + d.balance, 0),
            lentBalance: related.filter((d) => d.direction === "lent").reduce((s, d) => s + d.balance, 0),
            openCount: related.length,
        };
    });
}

export async function listDebtsByContact(
    ownerId: number,
    contactId: number,
    status: "open" | "closed" = "open",
): Promise<DebtWithMeta[]> {
    const rows = await db
        .select({
            id: debts.id,
            owner_id: debts.owner_id,
            contact_id: debts.contact_id,
            contact_name: contacts.name,
            direction: debts.direction,
            due_date: debts.due_date,
            status: debts.status,
            note: debts.note,
            created_at: debts.created_at,
        })
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(eq(debts.owner_id, ownerId), eq(debts.contact_id, contactId), eq(debts.status, status)))
        .orderBy(desc(debts.updated_at));

    const balances = await balanceForDebtIds(rows.map((r) => r.id));
    return rows.map((r) => ({
        ...r,
        direction: r.direction as Direction,
        status: r.status as "open" | "closed",
        balance: balances.get(r.id) ?? 0,
    }));
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
        balance: params.amount,
        created_at: debt.created_at,
    };
}

export async function addDebtItem(params: {
    debtId: number;
    type: "charge" | "repay";
    amount: number;
    createdBy: number;
    note?: string | null;
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

    return { balance: Math.max(balance, 0), closed };
}

export async function setDueDate(debtId: number, dueDate: string | null) {
    await db.update(debts).set({ due_date: dueDate }).where(eq(debts.id, debtId));
}

export async function closeDebt(debtId: number) {
    await db.update(debts).set({ status: "closed" }).where(eq(debts.id, debtId));
}

export async function getDebtById(debtId: number): Promise<DebtWithMeta | null> {
    const [row] = await db
        .select({
            id: debts.id,
            owner_id: debts.owner_id,
            contact_id: debts.contact_id,
            contact_name: contacts.name,
            direction: debts.direction,
            due_date: debts.due_date,
            status: debts.status,
            note: debts.note,
            created_at: debts.created_at,
        })
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(eq(debts.id, debtId))
        .limit(1);

    if (!row) return null;
    const balances = await balanceForDebtIds([row.id]);
    return {
        ...row,
        direction: row.direction as Direction,
        status: row.status as "open" | "closed",
        balance: balances.get(row.id) ?? 0,
    };
}

export async function getDebtItems(debtId: number): Promise<DebtItemRow[]> {
    return db.select().from(debtItems).where(eq(debtItems.debt_id, debtId)).orderBy(desc(debtItems.created_at));
}

/** Ownerning ochiq/yopiq qarzlari */
export async function listOwnedDebts(ownerId: number, status: "open" | "closed" = "open"): Promise<DebtWithMeta[]> {
    const rows = await db
        .select({
            id: debts.id,
            owner_id: debts.owner_id,
            contact_id: debts.contact_id,
            contact_name: contacts.name,
            direction: debts.direction,
            due_date: debts.due_date,
            status: debts.status,
            note: debts.note,
            created_at: debts.created_at,
        })
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(eq(debts.owner_id, ownerId), eq(debts.status, status)))
        .orderBy(desc(debts.updated_at));

    const balances = await balanceForDebtIds(rows.map((r) => r.id));
    return rows.map((r) => ({
        ...r,
        direction: r.direction as Direction,
        status: r.status as "open" | "closed",
        balance: balances.get(r.id) ?? 0,
    }));
}

async function activeSharesForUser(userId: number) {
    return db
        .select()
        .from(shares)
        .where(and(eq(shares.grantee_id, userId), eq(shares.status, "active")));
}

/** Ulashilgan qarzlar (grantee uchun) */
export async function listSharedDebts(granteeId: number, status: "open" | "closed" = "open"): Promise<DebtWithMeta[]> {
    const userShares = await activeSharesForUser(granteeId);
    if (!userShares.length) return [];

    const debtIdSet = new Set<number>();
    const contactPairs: { granterId: number; contactId: number }[] = [];
    const allGranters: number[] = [];

    for (const s of userShares) {
        if (s.scope === "debt" && s.debt_id) debtIdSet.add(s.debt_id);
        if (s.scope === "contact" && s.contact_id) contactPairs.push({ granterId: s.granter_id, contactId: s.contact_id });
        if (s.scope === "all") allGranters.push(s.granter_id);
    }

    const conditions = [];

    if (debtIdSet.size) {
        const byIds = await db
            .select({
                id: debts.id,
                owner_id: debts.owner_id,
                contact_id: debts.contact_id,
                contact_name: contacts.name,
                direction: debts.direction,
                due_date: debts.due_date,
                status: debts.status,
                note: debts.note,
                created_at: debts.created_at,
            })
            .from(debts)
            .innerJoin(contacts, eq(contacts.id, debts.contact_id))
            .where(and(inArray(debts.id, [...debtIdSet]), eq(debts.status, status)));
        conditions.push(...byIds);
    }

    if (contactPairs.length) {
        for (const pair of contactPairs) {
            const rows = await db
                .select({
                    id: debts.id,
                    owner_id: debts.owner_id,
                    contact_id: debts.contact_id,
                    contact_name: contacts.name,
                    direction: debts.direction,
                    due_date: debts.due_date,
                    status: debts.status,
                    note: debts.note,
                    created_at: debts.created_at,
                })
                .from(debts)
                .innerJoin(contacts, eq(contacts.id, debts.contact_id))
                .where(
                    and(
                        eq(debts.owner_id, pair.granterId),
                        eq(debts.contact_id, pair.contactId),
                        eq(debts.status, status),
                    ),
                );
            conditions.push(...rows);
        }
    }

    if (allGranters.length) {
        const rows = await db
            .select({
                id: debts.id,
                owner_id: debts.owner_id,
                contact_id: debts.contact_id,
                contact_name: contacts.name,
                direction: debts.direction,
                due_date: debts.due_date,
                status: debts.status,
                note: debts.note,
                created_at: debts.created_at,
            })
            .from(debts)
            .innerJoin(contacts, eq(contacts.id, debts.contact_id))
            .where(and(inArray(debts.owner_id, allGranters), eq(debts.status, status)));
        conditions.push(...rows);
    }

    const unique = new Map<number, (typeof conditions)[number]>();
    for (const row of conditions) unique.set(row.id, row);

    const rows = [...unique.values()];
    const balances = await balanceForDebtIds(rows.map((r) => r.id));

    return rows
        .map((r) => ({
            ...r,
            direction: r.direction as Direction,
            status: r.status as "open" | "closed",
            balance: balances.get(r.id) ?? 0,
        }))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
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

        // Account/debt ulashish — full access
        if (matches) return { canView: true, canWrite: true, isOwner: false };
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
}): Promise<{ token: string; id: number }> {
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

    return { token, id: row.id };
}

export async function acceptShareInvite(token: string, granteeId: number) {
    const [share] = await db.select().from(shares).where(eq(shares.invite_token, token)).limit(1);
    if (!share || share.status === "revoked") return null;
    if (share.granter_id === granteeId) return null;

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
        .select({
            id: debts.id,
            owner_id: debts.owner_id,
            contact_id: debts.contact_id,
            contact_name: contacts.name,
            direction: debts.direction,
            due_date: debts.due_date,
            status: debts.status,
            note: debts.note,
            created_at: debts.created_at,
        })
        .from(debts)
        .innerJoin(contacts, eq(contacts.id, debts.contact_id))
        .where(and(eq(debts.status, "open"), eq(debts.due_date, dateIso)));

    const balances = await balanceForDebtIds(rows.map((r) => r.id));
    return rows.map((r) => ({
        ...r,
        direction: r.direction as Direction,
        status: r.status as "open" | "closed",
        balance: balances.get(r.id) ?? 0,
    }));
}

export async function listActiveGranteesForDebt(debt: DebtWithMeta): Promise<{ userId: number }[]> {
    const rows = await db
        .select()
        .from(shares)
        .where(and(eq(shares.granter_id, debt.owner_id), eq(shares.status, "active")));

    const result: { userId: number }[] = [];
    for (const s of rows) {
        if (!s.grantee_id) continue;
        let matches = false;
        if (s.scope === "all") matches = true;
        if (s.scope === "contact" && s.contact_id === debt.contact_id) matches = true;
        if (s.scope === "debt" && s.debt_id === debt.id) matches = true;
        if (matches) result.push({ userId: s.grantee_id });
    }
    return result;
}
