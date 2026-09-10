import { afterAll, beforeAll, expect, test } from "bun:test";
import { db, schema as s } from "@table/db";
import { eq, sql } from "drizzle-orm";
import { hash } from "../../apps/api/src/auth";
import { execute } from "../../apps/api/src/operations";
import { adminSnapshot, insights } from "../../apps/api/src/queries";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test"))
  throw new Error("Recovery tests require an isolated *_test database.");
const port = 3188;
let child: ReturnType<typeof Bun.spawn> | undefined;
const qr = crypto.randomUUID().replaceAll("-", "");
const visitId = crypto.randomUUID(),
  tableId = crypto.randomUUID(),
  menuId = crypto.randomUUID(),
  userId = crypto.randomUUID();
const guestCookie = `guest_${qr}=${crypto.randomUUID()}`;
const user = {
  id: userId,
  login: "recovery-owner",
  name: "복구 검증",
  role: "owner" as const,
  active: true,
};
const basket = (key = crypto.randomUUID()) => ({
  requestId: key,
  lines: [{ menuId, quantity: 1, expectedPrice: 1000, note: "" }],
  note: "",
});
const action = (value: Parameters<typeof execute>[2]) => execute(user, crypto.randomUUID(), value);
let currentVisitId: string = visitId;
async function start() {
  child = Bun.spawn(["bun", "apps/api/src/index.ts"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/api/health/ready`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error("Recovery API failed to start");
}
async function kill() {
  if (child) {
    child.kill("SIGKILL");
    await child.exited;
    child = undefined;
  }
}
const post = (body: ReturnType<typeof basket>) =>
  fetch(`http://127.0.0.1:${port}/api/guest/${qr}/orders`, {
    method: "POST",
    headers: { cookie: guestCookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
beforeAll(async () => {
  await db.execute(
    sql`TRUNCATE commands, events, guest_sessions, sessions, order_items, payments, orders, visits, dining_tables, menus, categories, zones, users, rate_limits, settings RESTART IDENTITY CASCADE`,
  );
  await db.insert(s.settings).values({ id: 1 });
  await db
    .insert(s.users)
    .values({ ...user, passwordHash: await Bun.password.hash(crypto.randomUUID()) });
  await db.insert(s.tables).values({ id: tableId, name: "복구01", qrToken: qr, state: "occupied" });
  await db.insert(s.visits).values({ id: visitId, tableId, joinCode: "123456" });
  await db.insert(s.menus).values({ id: menuId, name: "복구 검증 메뉴", price: 1000 });
  await db.insert(s.guests).values({
    visitId,
    tokenHash: hash(guestCookie.split("=")[1]),
    expiresAt: new Date(Date.now() + 3600_000),
  });
});
afterAll(async () => {
  await kill();
  await db.execute(sql`DROP TRIGGER IF EXISTS recovery_pause ON order_items`);
  await db.execute(sql`DROP FUNCTION IF EXISTS recovery_pause_fn()`);
});

test("a real API kill before COMMIT leaves no partial order; original-key retry succeeds once", async () => {
  await db.execute(
    sql`CREATE FUNCTION recovery_pause_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3); RETURN NEW; END $$`,
  );
  await db.execute(
    sql`CREATE TRIGGER recovery_pause BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION recovery_pause_fn()`,
  );
  await start();
  const input = basket();
  const pending = post(input).catch(() => null);
  let sleeping = false;
  for (let i = 0; i < 100; i++) {
    const rows = await db.execute(
      sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'`,
    );
    if (rows.length) {
      sleeping = true;
      break;
    }
    await Bun.sleep(30);
  }
  expect(sleeping).toBe(true);
  await kill();
  await pending;
  await db.execute(sql`DROP TRIGGER recovery_pause ON order_items`);
  await db.execute(sql`DROP FUNCTION recovery_pause_fn()`);
  expect(await db.select().from(s.orders)).toHaveLength(0);
  expect(await db.select().from(s.items)).toHaveLength(0);
  expect(await db.select().from(s.commands)).toHaveLength(0);
  await start();
  const response = await post(input);
  expect(response.status).toBe(200);
  expect(await (await post(input)).json()).toEqual(await response.json());
  expect(await db.select().from(s.orders)).toHaveLength(1);
});

test("committed orders and commands survive process death, with new-device SSE backfill", async () => {
  const input = basket();
  const first = await post(input);
  expect(first.status).toBe(200);
  const original = await first.json();
  await kill();
  const started = performance.now();
  await start();
  expect(performance.now() - started).toBeLessThan(30000);
  expect(await (await post(input)).json()).toEqual(original);
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/guest/${qr}/events`, {
    headers: { cookie: guestCookie, "Last-Event-ID": "999999999" },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const event = await reader?.read();
  expect(new TextDecoder().decode(event?.value)).toContain("event: sync");
  controller.abort();
  const snap = await fetch(`http://127.0.0.1:${port}/api/guest/${qr}/snapshot`, {
    headers: { cookie: guestCookie },
  });
  const data = await snap.json();
  expect(data.orders).toHaveLength(2);
  expect(data.visit.total).toBe(2000);
  await kill();
});

test("settlement corrections preserve originals and historical menu prices in full-period aggregates", async () => {
  const state = await adminSnapshot(user);
  await action({
    type: "payment.settle",
    visitId,
    version: state.visits[0].version,
    method: "card",
    close: false,
  });
  const [payment] = await db.select().from(s.payments).where(eq(s.payments.visitId, visitId));
  await action({ type: "payment.void", paymentId: payment.id, reason: "결제 수단 오기록" });
  const [closedVisit] = await db.select().from(s.visits).where(eq(s.visits.id, visitId));
  await action({
    type: "payment.settle",
    visitId,
    version: closedVisit.version,
    method: "cash",
    close: false,
  });
  const records = await db.select().from(s.payments).where(eq(s.payments.visitId, visitId));
  expect(records).toHaveLength(2);
  expect(records.filter((p) => p.voidedAt)).toHaveLength(1);
  const report = await insights(new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000));
  expect(report.revenue).toBe(2000);
  expect(report.gross).toBe(4000);
  expect(report.visits).toBe(1);
  expect(report.unknownGuests).toBe(1);
  expect(report.items[0].revenue).toBe(2000);
});

test("late paper orders keep their actual and recorded time separately", async () => {
  const [current] = await db.select().from(s.payments).where(sql`${s.payments.voidedAt} is null`);
  await action({ type: "payment.void", paymentId: current.id, reason: "사후 주문 검증" });
  const [opened] = await db.insert(s.visits).values({ tableId, joinCode: "654321" }).returning();
  currentVisitId = opened.id;
  await db.update(s.tables).set({ state: "occupied" }).where(eq(s.tables.id, tableId));
  const orderedAt = new Date(Date.now() - 3600_000).toISOString();
  const result = await action({
    type: "order.create",
    visitId: currentVisitId,
    lines: basket().lines,
    custom: [],
    note: "",
    recovery: { orderedAt, reason: "연결 장애" },
  });
  const id = (result.data as { orderId: string }).orderId;
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  expect(order.orderedAt.toISOString()).toBe(orderedAt);
  expect(order.createdAt.getTime()).toBeGreaterThan(order.orderedAt.getTime());
  expect(order.recordedReason).toBe("연결 장애");
  await expect(
    action({
      type: "order.create",
      visitId: currentVisitId,
      lines: basket().lines,
      custom: [],
      note: "",
      recovery: { orderedAt: new Date(Date.now() + 86400_000).toISOString(), reason: "연결 장애" },
    }),
  ).rejects.toThrow("최근 7일");
});

test("latest serving state is recovered after restart even if old events are gone", async () => {
  const state = await adminSnapshot(user);
  const order = state.orders[0];
  await action({ type: "order.ack", orderId: order.id });
  await action({ type: "order.serve", orderId: order.id, version: order.version + 1 });
  await db.delete(s.events);
  await start();
  const snap = await fetch(`http://127.0.0.1:${port}/api/guest/${qr}/snapshot`, {
    headers: { cookie: guestCookie },
  });
  const recovered = await snap.json();
  expect(recovered.orders.find((o: { id: string }) => o.id === order.id).items[0].served).toBe(1);
  expect(recovered.orders).toHaveLength(1);
  await kill();
});
