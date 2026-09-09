import postgres from "postgres";

const url = new URL(process.env.DATABASE_URL ?? "");
const client = postgres(url.toString(), { max: 1 });
const name = "table_order_test";
const [existing] = await client`select datname from pg_database where datname=${name}`;
if (!existing) await client.unsafe('create database "table_order_test"');
await client.end();
url.pathname = `/${name}`;
await Bun.write(
  ".env.test",
  `DATABASE_URL=${url.toString()}\nNODE_ENV=test\nPUBLIC_ORIGIN=http://localhost:5174\nADMIN_ORIGIN=http://localhost:5173\n`,
);
await Bun.$`chmod 600 .env.test`;
const migration = Bun.spawn(["bun", "packages/db/src/migrate.ts"], {
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdout: "inherit",
  stderr: "inherit",
});
if (await migration.exited) process.exit(1);
console.log("Isolated test database prepared. Development orders are untouched.");
