import { asc, eq } from "drizzle-orm";
import { contacts, debtItems, debts, users } from "../db/schema";
import { runInTransaction, type DbExecutor } from "../db";
import type { Direction } from "../utils/types";
import { clearHideWhenZeroForContact, getOrCreateContact, getDebtById, type DebtWithMeta } from "./debts";

function flipDirection(direction: Direction): Direction {
    return direction === "borrowed" ? "lent" : "borrowed";
}

/**
 * Qarz ulashish qabul qilinganda: grantee uchun juft (twin) debt yaratadi.
 * Yo'nalish teskari, contact = granter ismi, itemlar nusxalanadi.
 */
export async function ensureTwinDebt(
    sourceDebtId: number,
    granteeId: number,
    exec?: DbExecutor,
): Promise<DebtWithMeta | null> {
    return runInTransaction(async (tx) => {
        // Parallel accept race uchun qatorni qulflash
        const [locked] = await tx
            .select({
                id: debts.id,
                owner_id: debts.owner_id,
                linked_debt_id: debts.linked_debt_id,
            })
            .from(debts)
            .where(eq(debts.id, sourceDebtId))
            .for("update")
            .limit(1);
        if (!locked) return null;
        if (locked.owner_id === granteeId) return null;

        if (locked.linked_debt_id) {
            const existing = await getDebtById(locked.linked_debt_id, tx);
            if (existing && existing.owner_id === granteeId) return existing;
            return null;
        }

        const source = await getDebtById(sourceDebtId, tx);
        if (!source) return null;

        const [owner] = await tx.select().from(users).where(eq(users.id, source.owner_id)).limit(1);
        if (!owner) return null;

        const contactName = owner.first_name?.trim() || `User ${owner.tg_id}`;
        const contact = await getOrCreateContact(granteeId, contactName, source.owner_id, tx);

        const [twin] = await tx
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

        const items = await tx
            .select()
            .from(debtItems)
            .where(eq(debtItems.debt_id, sourceDebtId))
            .orderBy(asc(debtItems.created_at));

        if (items.length) {
            await tx.insert(debtItems).values(
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

        await tx.update(debts).set({ linked_debt_id: twin.id }).where(eq(debts.id, sourceDebtId));
        await tx.update(debts).set({ linked_debt_id: sourceDebtId }).where(eq(debts.id, twin.id));

        // Kontaktni telegram user bilan bog'lash
        await tx
            .update(contacts)
            .set({ linked_user_id: source.owner_id })
            .where(eq(contacts.id, contact.id));

        // Ikkala tomonda kontakt ↔ telegram user bog'lanishi saqlansin (keyingi qarzlar auto-twin)
        await tx
            .update(contacts)
            .set({ linked_user_id: granteeId })
            .where(eq(contacts.id, source.contact_id));

        // Yangi twin = aktiv qarz → «ovushmayman» o'chadi (ikkala tomon)
        await clearHideWhenZeroForContact(contact.id, tx);
        await clearHideWhenZeroForContact(source.contact_id, tx);

        return getDebtById(twin.id, tx);
    }, exec);
}
