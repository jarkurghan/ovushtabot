import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    throw new Error("DATABASE_URL o'rnatilmagan");
}

export const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });
