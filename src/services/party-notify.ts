import { bot } from "../bot";
import { t } from "../i18n";
import { formatAmount, formatDate } from "../utils/format";
import type { User } from "../utils/types";
import {
    getDebtById,
    type DebtWithMeta,
} from "./debts";
import { getUserById } from "./save-user";
import { sendErrorLog } from "./log";

async function debtParties(debt: DebtWithMeta, excludeUserId: number): Promise<User[]> {
    const ids = new Set<number>();

    if (debt.owner_id !== excludeUserId) ids.add(debt.owner_id);

    
    if (debt.linked_debt_id) {
        const twin = await getDebtById(debt.linked_debt_id);
        if (twin && twin.owner_id !== excludeUserId) ids.add(twin.owner_id);
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
    await sendToParties(params.debtId, params.actor.id, (user, debt) => {
        const lent = debt.direction === "lent";
        const key =
            params.type === "repay"
                ? lent
                    ? "notify_item_repay_lent"
                    : "notify_item_repay_borrowed"
                : lent
                  ? "notify_item_charge_lent"
                  : "notify_item_charge_borrowed";

        let text = t(user.language, key, {
            name: debt.contact_name,
            amount: formatAmount(params.amount, user.language),
        });

        if (params.closed && params.type === "repay") {
            text += `\n${t(user.language, lent ? "notify_cleared_they_owe" : "notify_cleared_you_owe")}`;
        } else {
            text += `\n${t(user.language, "notify_remain", {
                balance: formatAmount(debt.balance, user.language),
            })}`;
        }
        return text;
    });
}

export async function notifyDebtCreated(params: { debt: DebtWithMeta; actor: User }) {
    await sendToParties(params.debt.id, params.actor.id, (user, debt) => {
        const key = debt.direction === "borrowed" ? "notify_debt_created_borrowed" : "notify_debt_created_lent";
        return t(user.language, key, {
            name: debt.contact_name,
            amount: formatAmount(debt.balance, user.language),
        });
    });
}

export async function notifyDebtDueChanged(params: {
    debtId: number;
    actor: User;
    dueDate: string | null;
}) {
    await sendToParties(params.debtId, params.actor.id, (user, debt) => {
        if (!params.dueDate) {
            return t(user.language, "notify_due_cleared", {
                name: debt.contact_name,
            });
        }
        return t(user.language, "notify_due_set", {
            name: debt.contact_name,
            due: formatDate(params.dueDate, user.language),
        });
    });
}
