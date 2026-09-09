import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
export const client = postgres(url, {
  max: Number(process.env.DB_POOL_SIZE ?? 20),
  idle_timeout: 20,
  connect_timeout: 5,
  connection: {
    statement_timeout: 8000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
    application_name: "table-order",
  },
});
export const db = drizzle(client, { schema });
export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export { schema };
