import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db, schema } from "./index";

const connection = await client.reserve();
try {
  await connection`select pg_advisory_lock(78482194)`;
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../migrations` });
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
  console.log("Database migrations complete.");
} finally {
  await connection`select pg_advisory_unlock(78482194)`;
  connection.release();
  await client.end();
}
