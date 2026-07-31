import { and, eq } from "drizzle-orm";
import { notificationLogs, users } from "../db/schema";
import { db } from "../db";
import { bot } from "../bot";
import { t } from "../i18n";
import { formatAmount, nowTimeInTashkent, todayInTashkent } from "../utils/format";
import { getUserById } from "../services/save-user";
import { listActiveGranteesForDebt, listDebtsDueOn } from "../services/debts";
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

            const recipients: { userId: number; tgId: string; lang: Lang; notifyBorrow: boolean; notifyLend: boolean }[] = [
                {
                    userId: owner.id,
                    tgId: owner.tg_id,
                    lang: owner.language,
                    notifyBorrow: owner.notify_borrow,
                    notifyLend: owner.notify_lend,
                },
            ];

            const grantees = await listActiveGranteesForDebt(debt);
            for (const g of grantees) {
                const u = await getUserById(g.userId);
                if (!u || u.status === "has_blocked") continue;
                recipients.push({
                    userId: u.id,
                    tgId: u.tg_id,
                    lang: u.language,
                    notifyBorrow: u.notify_borrow,
                    notifyLend: u.notify_lend,
                });
            }

            for (const r of recipients) {
                const [dbUser] = await db.select().from(users).where(eq(users.id, r.userId)).limit(1);
                if (!dbUser) continue;
                if (dbUser.notify_time !== now) continue;

                const allowed =
                    debt.direction === "borrowed" ? r.notifyBorrow : r.notifyLend;
                if (!allowed) continue;

                if (await alreadyNotified(debt.id, r.userId, today)) continue;

                // Grantee uchun matn: egasining yo'nalishi bo'yicha
                const text = messageFor(r.lang, debt.direction, debt.contact_name, debt.balance);

                try {
                    await bot.api.sendMessage(r.tgId, `🔔 ${text}`);
                    await markNotified(debt.id, r.userId, today);
                } catch (error) {
                    await sendErrorLog({ event: `Bildirishnoma yuborish (${r.tgId})`, error });
                }
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
