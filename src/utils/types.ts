import type { CallbackQueryContext, CommandContext, Context } from "grammy";
import type { ParseMode } from "@grammyjs/types";

export type Lang = "uz" | "cyrl";
export type Status = "new" | "active" | "inactive" | "deleted_account" | "has_blocked" | "other";
export type Direction = "borrowed" | "lent";

export interface User {
    id: number;
    tg_id: string;
    first_name: string;
    last_name: string | null;
    username: string | null;
    language: Lang;
    notify_time: string;
    notify_enabled: boolean;
    status: Status;
}

export type SaveUserData = {
    language?: Lang;
    notify_time?: string;
    notify_enabled?: boolean;
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
    | "item_note"
    | "add_due_date"
    | "repay_amount"
    | "charge_amount"
    | "set_due_date"
    | "rename_contact";

export type ItemNoteAction = "add" | "repay" | "charge";

export type SessionData = {
    step: SessionStep;
    direction?: Direction;
    contactName?: string;
    contactId?: number;
    debtId?: number;
    amount?: number;
    
    note?: string | null;
    
    itemAction?: ItemNoteAction;
    
    needsDueDate?: boolean;
    
    browseContactId?: number;
    
    browseDebtStatus?: "open" | "closed";
    updatedAt: number;
};
