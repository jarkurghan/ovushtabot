import { existsSync } from "fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./index";

async function main() {
    if (existsSync("drizzle/meta/_journal.json")) {
        await migrate(db, { migrationsFolder: "drizzle" });
    } else {
        console.warn("drizzle/meta/_journal.json topilmadi — schema migrate o'tkazib yuborildi");
    }

    // Account ulashish olib tashlandi — mavjud scope=all yozuvlarni yopish (idempotent)
    await sql`
        UPDATE shares
        SET status = 'revoked', updated_at = now()
        WHERE scope = 'all' AND status <> 'revoked'
    `;

    await sql`
        ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS hide_when_zero boolean NOT NULL DEFAULT false
    `;

    await sql.end({ timeout: 5 });
    console.log("Migration completed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
