import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { db } from "../db";
import { bot } from "../bot";
import { ADMIN_CHAT } from "../utils/constants";
import { sendErrorLog } from "./log";
import type { CTX, Lang, SaveUserData, Status, User } from "../utils/types";

type UserSelect = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;

export function mapDbUser(row: UserSelect): User {
    return {
        id: row.id,
        tg_id: row.tg_id ?? "",
        first_name: row.first_name ?? "",
        last_name: row.last_name ?? null,
        username: row.username ?? null,
        language: (row.language as Lang) || "uz",
        notify_time: row.notify_time || "09:00",
        notify_borrow: row.notify_borrow ?? true,
        notify_lend: row.notify_lend ?? true,
        status: row.status as Status,
    };
}

export function userLink(user: { tg_id: string | number; first_name?: string | null; last_name?: string | null; username?: string | null }): string {
    const fullName = `${user.first_name || "Noma'lum"} ${user.last_name || ""}`.trim();
    return user.username
        ? `<a href="tg://resolve?domain=${user.username}">${fullName}</a>`
        : `<a href="tg://user?id=${user.tg_id}">${fullName}</a>`;
}

export function groupLink(chat: { id: number; title?: string; username?: string | null }): string {
    const name = chat.title || "Noma'lum";
    return chat.username ? `<a href="https://t.me/${chat.username}">${name}</a>` : name;
}

export async function getUserByTgId(tgId: string | number): Promise<User | null> {
    const [row] = await db.select().from(users).where(eq(users.tg_id, String(tgId))).limit(1);
    return row ? mapDbUser(row) : null;
}

export async function getUserById(id: number): Promise<User | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? mapDbUser(row) : null;
}

export async function saveUser(ctx: CTX, data?: SaveUserData): Promise<User[]> {
    const from = ctx.from;
    if (!from) return [];

    const patch: Partial<UserInsert> = {
        tg_id: String(from.id),
        first_name: from.first_name,
        last_name: from.last_name || null,
        username: from.username || null,
    };

    if (data?.language) patch.language = data.language;
    if (data?.notify_time) patch.notify_time = data.notify_time;
    if (typeof data?.notify_borrow === "boolean") patch.notify_borrow = data.notify_borrow;
    if (typeof data?.notify_lend === "boolean") patch.notify_lend = data.notify_lend;
    if (data?.status) patch.status = data.status;

    try {
        const [existing] = await db.select().from(users).where(eq(users.tg_id, String(from.id))).limit(1);

        if (!existing) {
            patch.status = data?.status || "active";
            patch.language = data?.language || "uz";

            if (ADMIN_CHAT) {
                const utm = data?.utm || "organic";
                const username = from.username ? `@${from.username}` : "Noma'lum";
                const link = userLink({
                    tg_id: from.id,
                    first_name: from.first_name,
                    last_name: from.last_name,
                    username: from.username,
                });
                const msg =
                    `🆕 Yangi foydalanuvchi:\n\n👤 Ism: ${link}\n🔗 Username: ${username}\n` +
                    `🆔 ID: <code>${from.id}</code>\n🚪 Qayerdan: ${utm}\n🤖 Bot: debt`;
                await bot.api.sendMessage(ADMIN_CHAT, msg, { parse_mode: "HTML" }).catch(() => undefined);
            }

            const inserted = await db.insert(users).values(patch as UserInsert).returning();
            return inserted.map(mapDbUser);
        }

        const updateData: Partial<UserInsert> = {
            first_name: patch.first_name,
            last_name: patch.last_name,
            username: patch.username,
        };
        if (data?.language) updateData.language = data.language;
        if (data?.notify_time) updateData.notify_time = data.notify_time;
        if (typeof data?.notify_borrow === "boolean") updateData.notify_borrow = data.notify_borrow;
        if (typeof data?.notify_lend === "boolean") updateData.notify_lend = data.notify_lend;
        if (data?.status) updateData.status = data.status;

        // Blokdan qaytganda active qilish
        if (existing.status === "has_blocked" && !data?.status) {
            updateData.status = "active";
        }

        const updated = await db.update(users).set(updateData).where(eq(users.tg_id, String(from.id))).returning();
        return updated.map(mapDbUser);
    } catch (error) {
        await sendErrorLog({ event: "User saqlashda", error, ctx });
        return [];
    }
}
