import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

const root = `${import.meta.dir}/..`;
if (!existsSync(`${root}/.env`)) {
  const password = randomBytes(24).toString("hex");
  const owner = randomBytes(18).toString("base64url");
  await Bun.write(
    `${root}/.env`,
    `DATABASE_URL=postgres://table_order:${password}@127.0.0.1:55432/table_order\nPUBLIC_ORIGIN=http://localhost:5174\nADMIN_ORIGIN=http://localhost:5173\nHOST=127.0.0.1\nPORT=3000\nUPLOAD_DIR=./data/uploads\nADMIN_LOGIN=owner\nADMIN_PASSWORD=${owner}\nNODE_ENV=development\n`,
  );
  await Bun.write(
    `${root}/.env.db`,
    `POSTGRES_DB=table_order\nPOSTGRES_USER=table_order\nPOSTGRES_PASSWORD=${password}\n`,
  );
  await Bun.$`chmod 600 ${root}/.env ${root}/.env.db`;
}
const exists = Bun.spawnSync(["podman", "container", "exists", "table-order-dev-db"]);
const args =
  exists.exitCode === 0
    ? ["podman", "start", "table-order-dev-db"]
    : [
        "podman",
        "run",
        "-d",
        "--name",
        "table-order-dev-db",
        "--env-file",
        `${root}/.env.db`,
        "-p",
        "127.0.0.1:55432:5432",
        "-v",
        "table-order-dev-data:/var/lib/postgresql/data",
        "docker.io/library/postgres:17.11-alpine",
      ];
const p = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
if (await p.exited) process.exit(1);
for (let i = 0; i < 30; i++) {
  const ready = Bun.spawnSync([
    "podman",
    "exec",
    "table-order-dev-db",
    "pg_isready",
    "-U",
    "table_order",
  ]);
  if (!ready.exitCode) {
    console.log(
      "Development PostgreSQL ready on 127.0.0.1:55432. Credentials: .env (not committed).",
    );
    process.exit(0);
  }
  await Bun.sleep(1000);
}
throw new Error("PostgreSQL did not become ready within 30 seconds.");
