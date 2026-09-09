import { resolve } from "node:path";

for (const command of [
  ["bun", "scripts/dev-db.ts"],
  ["bun", "packages/db/src/migrate.ts"],
  ...(process.argv.includes("--demo") ? [["bun", "scripts/seed.ts"]] : []),
]) {
  const child = Bun.spawn(command, {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited) process.exit(1);
}
console.log(
  "준비 완료. bun dev 로 실행하세요. 관리자 초기 정보는 .env에 있어요. 운영 데이터는 초기화하지 않습니다.",
);
