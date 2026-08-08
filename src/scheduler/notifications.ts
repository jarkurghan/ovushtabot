import { and, eq } from "drizzle-orm";
import { notificationLogs } from "../db/schema";
import { db } from "../db";
import { bot } from "../bot";
import { t } from "../i18n";
import { formatAmount, nowTimeInTashkent, todayInTashkent } from "../utils/format";
import { getUserById } from "../services/save-user";
import { listDebtsDueOn } from "../services/debts";
import { sendErrorLog } from "../services/log";
import type { Lang } from "../utils/types";

async function alreadyNotified(debtId: number, userId: number, date: string): Promise<boolean> {
    const [row] = await db
        .select()
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.debt_id, debtId),
                eq(notificationLogs.user_id, userId),
                eq(notificationLogs.notify_date, date),
            ),
        )
        .limit(1);
    return !!row;
}

async function markNotified(debtId: number, userId: number, date: string) {
    await db
        .insert(notificationLogs)
        .values({ debt_id: debtId, user_id: userId, notify_date: date })
        .onConflictDoNothing({
            target: [notificationLogs.debt_id, notificationLogs.user_id, notificationLogs.notify_date],
        });
}

function messageFor(lang: Lang, direction: "borrowed" | "lent", name: string, amount: number): string {
    const key = direction === "borrowed" ? "notification_borrowed" : "notification_lent";
    return t(lang, key, { name, amount: formatAmount(amount, lang) });
}

export async function sendDueNotifications(): Promise<void> {
    try {
        const today = todayInTashkent();
        const now = nowTimeInTashkent();
        const dueDebts = await listDebtsDueOn(today);

        for (const debt of dueDebts) {
            if (debt.balance <= 0) continue;

            const owner = await getUserById(debt.owner_id);
            if (!owner || owner.status === "has_blocked") continue;

            if (owner.notify_time !== now) continue;
            if (!owner.notify_enabled) continue;

            if (await alreadyNotified(debt.id, owner.id, today)) continue;

            const text = messageFor(owner.language, debt.direction, debt.contact_name, debt.balance);

            try {
                await bot.api.sendMessage(owner.tg_id, `🔔 ${text}`);
                await markNotified(debt.id, owner.id, today);
            } catch (error) {
                await sendErrorLog({ event: `Bildirishnoma yuborish (${owner.tg_id})`, error });
            }
        }
    } catch (error) {
        await sendErrorLog({ event: "sendDueNotifications", error });
    }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startNotificationScheduler() {
    if (timer) return;
    // Har minut tekshiruv
    void sendDueNotifications();
    timer = setInterval(() => {
        void sendDueNotifications();
    }, 60_000);
    console.log("Notification scheduler started");
}
