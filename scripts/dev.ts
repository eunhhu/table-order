export {};

const processes = [
  Bun.spawn(["bun", "--watch", "apps/api/src/index.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "--cwd", "apps/admin", "dev"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "--cwd", "apps/customer", "dev"], { stdout: "inherit", stderr: "inherit" }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of processes) p.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(processes.map((p) => p.exited));
stop();
