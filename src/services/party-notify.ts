import { bot } from "../bot";
import { t } from "../i18n";
import { formatAmount, formatDate } from "../utils/format";
import type { User } from "../utils/types";
import {
    getDebtById,
    listActiveGranteesForDebt,
    type DebtWithMeta,
} from "./debts";
import { getUserById } from "./save-user";
import { sendErrorLog } from "./log";

async function debtParties(debt: DebtWithMeta, excludeUserId: number): Promise<User[]> {
    const ids = new Set<number>();

    if (debt.owner_id !== excludeUserId) ids.add(debt.owner_id);

    // Twin egasi — ikkinchi tomon
    if (debt.linked_debt_id) {
        const twin = await getDebtById(debt.linked_debt_id);
        if (twin && twin.owner_id !== excludeUserId) ids.add(twin.owner_id);
    }

    // Account managerlar
    const grantees = await listActiveGranteesForDebt(debt);
    for (const g of grantees) {
        if (g.userId !== excludeUserId) ids.add(g.userId);
    }

    const users: User[] = [];
    for (const id of ids) {
        const u = await getUserById(id);
        if (u && u.status !== "has_blocked") users.push(u);
    }
    return users;
}

async function sendToParties(debtId: number, actorId: number, buildText: (user: User, debt: DebtWithMeta) => string) {
    const debt = await getDebtById(debtId);
    if (!debt) return;

    const parties = await debtParties(debt, actorId);
    for (const user of parties) {
        try {
            // Twin egasiga o'z nuqtai nazaridagi matn
            let viewDebt = debt;
            if (debt.linked_debt_id) {
                const twin = await getDebtById(debt.linked_debt_id);
                if (twin && twin.owner_id === user.id) viewDebt = twin;
            }
            await bot.api.sendMessage(user.tg_id, buildText(user, viewDebt), { parse_mode: "HTML" });
        } catch (error) {
            await sendErrorLog({ event: `Party notify (${user.tg_id})`, error });
        }
    }
}

export async function notifyDebtItemAdded(params: {
    debtId: number;
    actor: User;
    type: "charge" | "repay";
    amount: number;
    balance: number;
    closed: boolean;
}) {
    const actorName = params.actor.first_name || "User";

    await sendToParties(params.debtId, params.actor.id, (user, debt) => {
        const key = params.type === "repay" ? "notify_item_repay" : "notify_item_charge";
        let text = t(user.language, key, {
            actor: actorName,
            name: debt.contact_name,
            amount: formatAmount(params.amount, user.language),
            balance: formatAmount(debt.balance, user.language),
        });
        if (params.closed) {
            text += `\n${t(user.language, "notify_debt_closed_auto", { name: debt.contact_name })}`;
        }
        return text;
    });
}

export async function notifyDebtClosed(params: { debtId: number; actor: User }) {
    const actorName = params.actor.first_name || "User";

    await sendToParties(params.debtId, params.actor.id, (user, debt) =>
        t(user.language, "notify_debt_closed", {
            actor: actorName,
            name: debt.contact_name,
        }),
    );
}

export async function notifyDebtCreated(params: { debt: DebtWithMeta; actor: User }) {
    const actorName = params.actor.first_name || "User";

    await sendToParties(params.debt.id, params.actor.id, (user, debt) => {
        const dirKey = debt.direction === "borrowed" ? "direction_borrowed" : "direction_lent";
        return t(user.language, "notify_debt_created", {
            actor: actorName,
            name: debt.contact_name,
            direction: t(user.language, dirKey),
            amount: formatAmount(debt.balance, user.language),
        });
    });
}

export async function notifyDebtDueChanged(params: {
    debtId: number;
    actor: User;
    dueDate: string | null;
}) {
    const actorName = params.actor.first_name || "User";

    await sendToParties(params.debtId, params.actor.id, (user, debt) => {
        if (!params.dueDate) {
            return t(user.language, "notify_due_cleared", {
                actor: actorName,
                name: debt.contact_name,
            });
        }
        return t(user.language, "notify_due_set", {
            actor: actorName,
            name: debt.contact_name,
            due: formatDate(params.dueDate, user.language),
        });
    });
}
