import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    throw new Error("DATABASE_URL o'rnatilmagan");
}

export const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

/** Global db yoki transaction client — bir xil query API */
export type DbExecutor = PostgresJsDatabase<typeof schema>;

/**
 * Agar `exec` berilsa — shu executor ichida ishlaydi (nested tx yo'q).
 * Aks holda yangi transaction ochadi.
 */
export async function runInTransaction<T>(
    fn: (tx: DbExecutor) => Promise<T>,
    exec?: DbExecutor,
): Promise<T> {
    if (exec) return fn(exec);
    return db.transaction((tx) => fn(tx as DbExecutor));
}
