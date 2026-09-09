import { existsSync } from "node:fs";

// `bun run` inherits the development .env. Do not let that override .env.test in the child.
const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
if (existsSync(".env.test")) {
  for (const key of ["DATABASE_URL", "PUBLIC_ORIGIN", "ADMIN_ORIGIN"]) delete env[key];
}
const child = Bun.spawn(["bun", "test", "--timeout", "30000", ...process.argv.slice(2)], {
  env,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
