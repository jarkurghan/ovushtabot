import type { CallbackQueryContext, CommandContext, Context } from "grammy";
import type { ParseMode } from "@grammyjs/types";
import type { users } from "../db/schema";

export type Lang = "uz" | "cyrl";
export type Status = "new" | "active" | "inactive" | "deleted_account" | "has_blocked" | "other";
export type Direction = "borrowed" | "lent";
export type DebtItemType = "charge" | "repay";
export type AccessLevel = "view" | "write";
export type ShareScope = "all" | "contact" | "debt";
export type ShareStatus = "pending" | "active" | "revoked";

export type UserRow = typeof users.$inferSelect;

export interface User {
    id: number;
    tg_id: string;
    first_name: string;
    last_name: string | null;
    username: string | null;
    language: Lang;
    notify_time: string;
    notify_borrow: boolean;
    notify_lend: boolean;
    status: Status;
}

export type SaveUserData = {
    language?: Lang;
    notify_time?: string;
    notify_borrow?: boolean;
    notify_lend?: boolean;
    status?: Status;
    utm?: string;
};

export type CTX = CommandContext<Context> | CallbackQueryContext<Context> | Context;

export type LogOptions = { parse_mode?: ParseMode; reply_to_message_id?: number };
export type ErrorLogOptions = {
    ctx?: Context;
    event: string;
    error: unknown;
    reply_to_message_id?: number;
    parse_mode?: ParseMode;
};

export type SessionStep =
    | "idle"
    | "add_contact_name"
    | "add_amount"
    | "add_due_date"
    | "repay_amount"
    | "charge_amount"
    | "set_due_date"
    | "share_waiting"
    | "notify_time"
    | "browse_contacts";

export type SessionData = {
    step: SessionStep;
    direction?: Direction;
    contactName?: string;
    contactId?: number;
    debtId?: number;
    amount?: number;
    /** Account ulashish orqali boshqa user nomidan yozish */
    asOwnerId?: number;
    /** Tanishlar bo'limidan ochilgan qarz — ortga qaytish uchun */
    browseContactId?: number;
    updatedAt: number;
};
