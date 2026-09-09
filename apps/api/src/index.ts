import { client, db, schema as s } from "@table/db";
import { eq } from "drizzle-orm";
import { app } from "./app";
import { startEventPump } from "./events";

const [settings] = await db.select().from(s.settings).where(eq(s.settings.id, 1));
if (!settings) throw new Error("Run bun run db:migrate before starting the API.");
const [owner] = await db
  .select({ id: s.users.id })
  .from(s.users)
  .where(eq(s.users.role, "owner"))
  .limit(1);
if (!owner) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("First start requires ADMIN_PASSWORD (at least 12 characters).");
  await db
    .insert(s.users)
    .values({
      login: process.env.ADMIN_LOGIN ?? "owner",
      name: "점주",
      role: "owner",
      passwordHash: await Bun.password.hash(password),
    })
    .onConflictDoNothing();
}
const stopEvents = startEventPump();
app.listen({ hostname: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 3000) });
console.log(JSON.stringify({ level: "info", event: "ready", port: app.server?.port }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  stopEvents();
  await app.stop();
  await client.end({ timeout: 8 });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
