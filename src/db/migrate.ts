import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./index";

async function main() {
    await migrate(db, { migrationsFolder: "drizzle" });
    await sql.end({ timeout: 5 });
    console.log("Migration completed");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
