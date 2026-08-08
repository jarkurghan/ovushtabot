import { asc, eq } from "drizzle-orm";
import { contacts, debtItems, debts, users } from "../db/schema";
import { db } from "../db";
import type { Direction } from "../utils/types";
import { getOrCreateContact, getDebtById, type DebtWithMeta } from "./debts";

function flipDirection(direction: Direction): Direction {
    return direction === "borrowed" ? "lent" : "borrowed";
}

/**
 * Qarz ulashish qabul qilinganda: grantee uchun juft (twin) debt yaratadi.
 * Yo'nalish teskari, contact = granter ismi, itemlar nusxalanadi.
 */
export async function ensureTwinDebt(sourceDebtId: number, granteeId: number): Promise<DebtWithMeta | null> {
    const source = await getDebtById(sourceDebtId);
    if (!source) return null;
    if (source.owner_id === granteeId) return null;

    if (source.linked_debt_id) {
        const existing = await getDebtById(source.linked_debt_id);
        if (existing && existing.owner_id === granteeId) return existing;
        return null;
    }

    const [owner] = await db.select().from(users).where(eq(users.id, source.owner_id)).limit(1);
    if (!owner) return null;

    const contactName = owner.first_name?.trim() || `User ${owner.tg_id}`;
    const contact = await getOrCreateContact(granteeId, contactName, source.owner_id);

    const [twin] = await db
        .insert(debts)
        .values({
            owner_id: granteeId,
            contact_id: contact.id,
            direction: flipDirection(source.direction),
            due_date: source.due_date,
            status: source.status,
            note: source.note,
        })
        .returning();

    const items = await db
        .select()
        .from(debtItems)
        .where(eq(debtItems.debt_id, sourceDebtId))
        .orderBy(asc(debtItems.created_at));

    if (items.length) {
        await db.insert(debtItems).values(
            items.map((item) => ({
                debt_id: twin.id,
                type: item.type,
                amount: item.amount,
                note: item.note,
                created_by: granteeId,
                created_at: item.created_at,
            })),
        );
    }

    await db.update(debts).set({ linked_debt_id: twin.id }).where(eq(debts.id, sourceDebtId));
    await db.update(debts).set({ linked_debt_id: sourceDebtId }).where(eq(debts.id, twin.id));

    // Kontaktni telegram user bilan bog'lash
    await db
        .update(contacts)
        .set({ linked_user_id: source.owner_id })
        .where(eq(contacts.id, contact.id));

    const [ownerContact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, source.contact_id))
        .limit(1);
    if (ownerContact && !ownerContact.linked_user_id) {
        await db.update(contacts).set({ linked_user_id: granteeId }).where(eq(contacts.id, source.contact_id));
    }

    return getDebtById(twin.id);
}
