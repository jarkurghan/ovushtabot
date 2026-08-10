import { existsSync } from "fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./index";

async function main() {
    if (existsSync("drizzle/meta/_journal.json")) {
        await migrate(db, { migrationsFolder: "drizzle" });
    } else {
        console.warn("drizzle/meta/_journal.json topilmadi — schema migrate o'tkazib yuborildi");
    }

    
    await sql`
        UPDATE shares
        SET status = 'revoked', updated_at = now()
        WHERE scope = 'all' AND status <> 'revoked'
    `;

    await sql`
    ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS hide_when_zero boolean NOT NULL DEFAULT false
    `;

    
    await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT true
    `;
    await sql`
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'notify_borrow'
        ) THEN
            UPDATE users SET notify_enabled = (notify_borrow OR notify_lend);
        END IF;
    END $$
    `;
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS notify_borrow`;
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS notify_lend`;

    await sql.end({ timeout: 5 });
    console.log("Migration completed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
