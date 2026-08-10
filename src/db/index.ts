import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    throw new Error("DATABASE_URL o'rnatilmagan");
}

export const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });


export type DbExecutor = PostgresJsDatabase<typeof schema>;


export async function runInTransaction<T>(
    fn: (tx: DbExecutor) => Promise<T>,
    exec?: DbExecutor,
): Promise<T> {
    if (exec) return fn(exec);
    return db.transaction((tx) => fn(tx as DbExecutor));
}
