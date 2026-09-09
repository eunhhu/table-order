import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Action, AdminSnapshot, CommandResult } from "@table/contracts";
import postgres from "postgres";

const argument = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const seconds = argument("--seconds", 180);
const rate = argument("--rate", 20);
assert(Number.isInteger(seconds) && seconds >= 10 && seconds <= 28800);
assert(Number.isInteger(rate) && rate >= 1 && rate <= 100);
const original = new URL(process.env.DATABASE_URL ?? "");
assert(
  ["127.0.0.1", "localhost"].includes(original.hostname),
  "This tool only creates load data in a local development PostgreSQL.",
);
const databaseName = `ongi_load_${Date.now()}`;
const control = postgres(original.toString(), { max: 2 });
await control.unsafe(`CREATE DATABASE ${databaseName}`);
const url = new URL(original);
url.pathname = databaseName;
process.env.DATABASE_URL = url.toString();
const port = 3199;
const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  ADMIN_ORIGIN: `http://127.0.0.1:${port}`,
};
const migrate = Bun.spawn(["bun", "packages/db/src/migrate.ts"], {
  env,
  stdout: "pipe",
  stderr: "pipe",
});
assert.equal(await migrate.exited, 0, "Load database migration failed");
const { db, client, schema: s } = await import("@table/db");
const { sql } = await import("drizzle-orm");
const { hash } = await import("../apps/api/src/auth");
const expiration = new Date(Date.now() + 36 * 3600_000);
const passwordHash = await Bun.password.hash(crypto.randomUUID());
const people = Array.from({ length: 20 }, (_, i) => ({
  id: crypto.randomUUID(),
  login: `load-${i}`,
  name: `검증직원${i}`,
  role: i === 0 ? ("owner" as const) : ("staff" as const),
  passwordHash,
}));
await db.insert(s.users).values(people);
const staff = people.map((p) => ({ ...p, cookie: `staff_session=${crypto.randomUUID()}` }));
await db.insert(s.sessions).values(
  staff.map((p) => ({
    userId: p.id,
    tokenHash: hash(p.cookie.split("=")[1]),
    expiresAt: expiration,
  })),
);
const [menu] = await db.insert(s.menus).values({ name: "부하 검증 메뉴", price: 1000 }).returning();
const tableRows = Array.from({ length: 100 }, (_, i) => ({
  id: crypto.randomUUID(),
  name: String(i + 1).padStart(3, "0"),
  sort: i,
  qrToken: crypto.randomUUID().replaceAll("-", ""),
  state: "occupied" as const,
}));
await db.insert(s.tables).values(tableRows);
const visits = tableRows.map((t) => ({
  id: crypto.randomUUID(),
  tableId: t.id,
  joinCode: "123456",
}));
await db.insert(s.visits).values(visits);
const tables = tableRows.map((t, i) => ({
  ...t,
  visitId: String(visits[i].id),
  orders: 0,
  cookies: Array.from({ length: 5 }, () => `guest_${t.qrToken}=${crypto.randomUUID()}`),
  streams: [] as AbortController[],
}));
await db.insert(s.guests).values(
  tables.flatMap((t) =>
    t.cookies.map((cookie) => ({
      visitId: t.visitId,
      tokenHash: hash(cookie.split("=")[1]),
      expiresAt: expiration,
    })),
  ),
);
await mkdir("output/performance", { recursive: true });
const child = Bun.spawn(["bun", "apps/api/src/index.ts"], {
  env,
  stdout: Bun.file(`output/performance/${databaseName}-server.log`),
  stderr: Bun.file(`output/performance/${databaseName}-errors.log`),
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  if (
    await fetch(`${base}/api/health/ready`)
      .then((r) => r.ok)
      .catch(() => false)
  )
    break;
  await Bun.sleep(100);
  if (i === 99) throw new Error("Load API did not start");
}
let active = true,
  accepted = 0,
  failures = 0,
  snapshotFailures = 0,
  snapshots = 0,
  streamsOpened = 0;
const latencies: number[] = [],
  endToEnd: number[] = [],
  queueDelays: number[] = [],
  errors: Record<string, number> = {},
  measurements: unknown[] = [];
const controllers = new Set<AbortController>();
const streamTasks = new Set<Promise<void>>();
const orderIds = new Set<string>();
async function request<T>(path: string, cookie: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, "content-type": "application/json", origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}:${data.error}`);
  return data as T;
}
const action = (value: Action, worker = 0) =>
  request<CommandResult>("/api/admin/actions", staff[worker % 20].cookie, {
    requestId: crypto.randomUUID(),
    action: value,
  });
function subscribe(path: string, cookie: string, snapshot: string) {
  const controller = new AbortController();
  controllers.add(controller);
  let refreshRunning = false;
  let queued: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    if (!active || controller.signal.aborted || refreshRunning) return;
    refreshRunning = true;
    try {
      await request(snapshot, cookie);
      snapshots++;
    } catch {
      snapshotFailures++;
    } finally {
      refreshRunning = false;
    }
  }
  const periodic = setInterval(() => void refresh(), 6000 + Math.random() * 1500);
  const task = (async () => {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { cookie },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
      streamsOpened++;
      const reader = response.body.getReader();
      while (active && !controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (new TextDecoder().decode(chunk.value).includes("event: sync")) {
          clearTimeout(queued);
          queued = setTimeout(() => void refresh(), 150);
        }
      }
    } catch {
      if (!controller.signal.aborted && active) snapshotFailures++;
    } finally {
      clearInterval(periodic);
      clearTimeout(queued);
      controllers.delete(controller);
    }
  })();
  streamTasks.add(task);
  void task.finally(() => streamTasks.delete(task));
  return controller;
}
for (const p of staff) subscribe("/api/admin/events", p.cookie, "/api/admin/snapshot");
for (const t of tables)
  for (const cookie of t.cookies)
    t.streams.push(
      subscribe(`/api/guest/${t.qrToken}/events`, cookie, `/api/guest/${t.qrToken}/snapshot`),
    );
await Bun.sleep(2000);
assert.equal(
  streamsOpened,
  520,
  "All 500 guest and 20 staff SSE connections must actually open before load starts",
);
const queues = tables.map(() => Promise.resolve());
const started = performance.now();
const reporter = setInterval(async () => {
  const [count] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(s.orders);
  const diagnostics = await request<{ process: { rssMB: number } }>(
    "/api/admin/diagnostics",
    staff[0].cookie,
  ).catch(() => null);
  const measurement = {
    seconds: Math.round((performance.now() - started) / 1000),
    accepted,
    failures,
    snapshotFailures,
    openStreams: controllers.size,
    dbOrders: count.count,
    rssMB: Math.round(process.memoryUsage.rss() / 1048576),
    apiRssMB: diagnostics?.process.rssMB ?? null,
  };
  measurements.push(measurement);
  console.log(JSON.stringify(measurement));
}, 15000);
async function orderAt(index: number) {
  const t = tables[index % 100];
  const worker = index % 20;
  try {
    const requestId = crypto.randomUUID();
    const body = {
      requestId,
      lines: [{ menuId: menu.id, quantity: 1, expectedPrice: 1000, note: "" }],
      note: "",
    };
    const begin = performance.now();
    queueDelays.push(begin - (started + index * (1000 / rate)));
    const result = await request<CommandResult>(
      `/api/guest/${t.qrToken}/orders`,
      t.cookies[index % 5],
      body,
    );
    latencies.push(performance.now() - begin);
    endToEnd.push(performance.now() - (started + index * (1000 / rate)));
    accepted++;
    const id = (result.data as { orderId: string }).orderId;
    assert(!orderIds.has(id));
    orderIds.add(id);
    if (index % 25 === 0) {
      const replay = await request<CommandResult>(
        `/api/guest/${t.qrToken}/orders`,
        t.cookies[index % 5],
        body,
      );
      assert.equal((replay.data as { orderId: string }).orderId, id);
    }
    await action({ type: "order.ack", orderId: id }, worker);
    await action({ type: "order.serve", orderId: id, version: 2 }, worker);
    t.orders++;
    if (t.orders >= 20) {
      const state = await request<AdminSnapshot>("/api/admin/snapshot", staff[worker].cookie);
      const v = state.visits.find((v) => v.id === t.visitId);
      assert(v);
      await action(
        { type: "payment.settle", visitId: v.id, version: v.version, method: "card", close: true },
        worker,
      );
      await action({ type: "table.clean", id: t.id }, worker);
      const next = await action({ type: "visit.open", tableId: t.id, guests: null }, worker);
      t.visitId = (next.data as { visitId: string }).visitId;
      t.orders = 0;
      for (const stream of t.streams) stream.abort();
      t.streams = [];
      for (let i = 0; i < t.cookies.length; i++) {
        const joined = await fetch(`${base}/api/guest/${t.qrToken}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: "{}",
        });
        assert.equal(joined.status, 200);
        t.cookies[i] = joined.headers.get("set-cookie")?.split(";")[0] ?? "";
        t.streams.push(
          subscribe(
            `/api/guest/${t.qrToken}/events`,
            t.cookies[i],
            `/api/guest/${t.qrToken}/snapshot`,
          ),
        );
      }
    }
  } catch (e) {
    failures++;
    const reason = (e as Error).message;
    errors[reason] = (errors[reason] ?? 0) + 1;
  }
}
try {
  for (let n = 0; n < seconds * rate; n++) {
    const target = started + n * (1000 / rate);
    const delay = target - performance.now();
    if (delay > 0) await Bun.sleep(delay);
    const i = n % 100;
    queues[i] = queues[i].then(() => orderAt(n));
  }
  await Promise.all(queues);
  const [counts] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(s.orders);
  const [amount] = await db
    .select({
      value:
        sql<number>`sum((${s.items.quantity}-${s.items.cancelled})::bigint*${s.items.price})`.mapWith(
          Number,
        ),
    })
    .from(s.items);
  const current = await request<AdminSnapshot>("/api/admin/snapshot", staff[0].cookie);
  const [paid] = await db
    .select({ value: sql<number>`coalesce(sum(${s.payments.amount}),0)`.mapWith(Number) })
    .from(s.payments)
    .where(sql`${s.payments.voidedAt} is null`);
  assert.equal(counts.count, accepted);
  assert.equal(amount.value, accepted * 1000);
  assert.equal(paid.value + current.visits.reduce((sum, v) => sum + v.total, 0), amount.value);
  latencies.sort((a, b) => a - b);
  endToEnd.sort((a, b) => a - b);
  queueDelays.sort((a, b) => a - b);
  const report = {
    at: new Date().toISOString(),
    database: databaseName,
    runtime: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    tableCount: 100,
    guestSse: 500,
    staffSse: 20,
    seconds,
    rate,
    actualSeconds: (performance.now() - started) / 1000,
    accepted,
    failures,
    snapshotFailures,
    snapshots,
    dbOrders: counts.count,
    orderAmount: amount.value,
    p50ms: latencies[Math.floor(latencies.length * 0.5)],
    p95ms: latencies[Math.floor(latencies.length * 0.95)],
    p99ms: latencies[Math.floor(latencies.length * 0.99)],
    endToEndP95ms: endToEnd[Math.floor(endToEnd.length * 0.95)],
    queueDelayP95ms: queueDelays[Math.floor(queueDelays.length * 0.95)],
    errors,
    measurements,
  };
  await mkdir("output/performance", { recursive: true });
  const path = `output/performance/${databaseName}.json`;
  await Bun.write(path, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      report: path,
      accepted,
      failures,
      snapshotFailures,
      p95ms: report.p95ms,
      accurate: true,
    }),
  );
  if (failures || snapshotFailures) process.exitCode = 1;
} finally {
  active = false;
  clearInterval(reporter);
  for (const controller of controllers) controller.abort();
  await Promise.allSettled([...streamTasks]);
  child.kill("SIGTERM");
  await child.exited;
  await client.end();
  await control.end();
}
