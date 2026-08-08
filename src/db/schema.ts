import {
    boolean,
    date,
    integer,
    bigint,
    pgTable,
    text,
    varchar,
    timestamp,
    uniqueIndex,
    index,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const users = pgTable(
    "users",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity({ startWith: 1 }),
        tg_id: varchar("tg_id", { length: 255 }).notNull(),
        first_name: text("first_name"),
        last_name: text("last_name"),
        username: text("username"),
        language: text("language", { enum: ["uz", "cyrl"] }).default("uz").notNull(),
        notify_time: varchar("notify_time", { length: 5 }).default("09:00").notNull(),
        notify_borrow: boolean("notify_borrow").default(true).notNull(),
        notify_lend: boolean("notify_lend").default(true).notNull(),
        status: text("status", {
            enum: ["new", "active", "inactive", "deleted_account", "has_blocked", "other"],
        })
            .default("new")
            .notNull(),
        created_at: timestamp("created_at").defaultNow().notNull(),
        updated_at: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [uniqueIndex("users_tg_id_unique").on(table.tg_id)],
);

/** Qarzning ikkinchi tomoni (ism bilan). */
export const contacts = pgTable(
    "contacts",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
        owner_id: integer("owner_id")
            .notNull()
            .references(() => users.id),
        name: text("name").notNull(),
        linked_user_id: integer("linked_user_id").references(() => users.id),
        created_at: timestamp("created_at").defaultNow().notNull(),
        updated_at: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [
        index("contacts_owner_idx").on(table.owner_id),
        uniqueIndex("contacts_owner_name_unique").on(table.owner_id, table.name),
    ],
);

/**
 * Alohida qarz.
 * linked_debt_id — ikkinchi tomon qarzining jufti (twin).
 * Ulashilganda grantee uchun alohida debt yozuvi yaratiladi (yo'nalish teskari) va ikkisi bog'lanadi.
 */
export const debts = pgTable(
    "debts",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
        owner_id: integer("owner_id")
            .notNull()
            .references(() => users.id),
        contact_id: integer("contact_id")
            .notNull()
            .references(() => contacts.id),
        /** owner nuqtai nazaridan: borrowed = oldim, lent = berdim */
        direction: text("direction", { enum: ["borrowed", "lent"] }).notNull(),
        due_date: date("due_date"),
        status: text("status", { enum: ["open", "closed"] }).default("open").notNull(),
        note: text("note"),
        /** Ikkinchi tomondagi juft qarz (qabul qilingan debt-share) */
        linked_debt_id: integer("linked_debt_id").references((): AnyPgColumn => debts.id),
        created_at: timestamp("created_at").defaultNow().notNull(),
        updated_at: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [
        index("debts_owner_idx").on(table.owner_id),
        index("debts_contact_idx").on(table.contact_id),
        index("debts_due_date_idx").on(table.due_date),
        index("debts_status_idx").on(table.status),
        uniqueIndex("debts_linked_debt_id_unique").on(table.linked_debt_id),
    ],
);

/** Qarz harakatlari: boshlang'ich summa, qaytarish, qo'shimcha. */
export const debtItems = pgTable(
    "debt_items",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
        debt_id: integer("debt_id")
            .notNull()
            .references(() => debts.id),
        /** charge = qarz oshadi, repay = qarz kamayadi */
        type: text("type", { enum: ["charge", "repay"] }).notNull(),
        amount: bigint("amount", { mode: "number" }).notNull(),
        note: text("note"),
        created_by: integer("created_by")
            .notNull()
            .references(() => users.id),
        created_at: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("debt_items_debt_idx").on(table.debt_id)],
);

/**
 * Ulashish:
 * - scope=all  → account ulashish: granter nomidan to'liq boshqaruv
 * - scope=debt → taklif (pending); qabulda twin debt yaratiladi, keyin grantee o'z Qarzlarimida ko'radi
 * access: doim "write" (full).
 */
export const shares = pgTable(
    "shares",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
        granter_id: integer("granter_id")
            .notNull()
            .references(() => users.id),
        grantee_id: integer("grantee_id").references(() => users.id),
        scope: text("scope", { enum: ["all", "contact", "debt"] }).notNull(),
        contact_id: integer("contact_id").references(() => contacts.id),
        debt_id: integer("debt_id").references(() => debts.id),
        access: text("access", { enum: ["view", "write"] }).notNull().default("write"),
        /** Taklif qabul qilinmaguncha token saqlanadi */
        invite_token: varchar("invite_token", { length: 64 }),
        status: text("status", { enum: ["pending", "active", "revoked"] }).default("pending").notNull(),
        created_at: timestamp("created_at").defaultNow().notNull(),
        updated_at: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
    (table) => [
        index("shares_granter_idx").on(table.granter_id),
        index("shares_grantee_idx").on(table.grantee_id),
        uniqueIndex("shares_invite_token_unique").on(table.invite_token),
    ],
);

/** Kunlik eslatma dublikatini oldini olish. */
export const notificationLogs = pgTable(
    "notification_logs",
    {
        id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
        debt_id: integer("debt_id")
            .notNull()
            .references(() => debts.id),
        user_id: integer("user_id")
            .notNull()
            .references(() => users.id),
        notify_date: date("notify_date").notNull(),
        created_at: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("notification_logs_unique").on(table.debt_id, table.user_id, table.notify_date),
    ],
);
