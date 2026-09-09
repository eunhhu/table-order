import { beforeEach, expect, test } from "bun:test";
import { db, schema as s } from "@table/db";
import { sql } from "drizzle-orm";
import { insights } from "../../apps/api/src/queries";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test"))
  throw new Error("An isolated *_test database is required.");
const tableId = crypto.randomUUID();
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE commands, events, guest_sessions, sessions, order_items, payments, orders, visits, dining_tables, menus, categories, zones, users, rate_limits, settings RESTART IDENTITY CASCADE`,
  );
  await db.insert(s.settings).values({ id: 1, businessDayStart: 5 });
  await db
    .insert(s.tables)
    .values({ id: tableId, name: "통계 검증", qrToken: crypto.randomUUID().replaceAll("-", "") });
});
test("full-period totals and zero-payment visits are independent of 100-row pagination", async () => {
  const at = new Date("2026-09-09T12:00:00+09:00");
  const visits = Array.from({ length: 105 }, (_, i) => ({
    id: crypto.randomUUID(),
    tableId,
    joinCode: "123456",
    state: "closed" as const,
    startedAt: at,
    endedAt: at,
    guests: i % 2 ? 2 : null,
  }));
  await db.insert(s.visits).values(visits);
  await db.insert(s.payments).values(
    visits.slice(0, 104).map((v) => ({
      visitId: v.id,
      tableName: "통계 검증",
      amount: 1000,
      method: "card" as const,
      actor: "검증",
      createdAt: at,
    })),
  );
  const from = new Date("2026-09-09T05:00:00+09:00"),
    until = new Date("2026-09-10T05:00:00+09:00");
  const first = await insights(from, until),
    next = await insights(from, until, 1);
  expect(first.payments).toHaveLength(100);
  expect(next.payments).toHaveLength(4);
  expect(first.visitRecords).toHaveLength(100);
  expect(next.visitRecords).toHaveLength(5);
  expect(first.revenue).toBe(104000);
  expect(next.revenue).toBe(first.revenue);
  expect(first.paymentCount).toBe(104);
  expect(first.visits).toBe(105);
  expect(first.unknownGuests).toBe(53);
  expect(first.guests).toBe(104);
  expect(new Set([...first.payments, ...next.payments].map((p) => p.id)).size).toBe(104);
});
test("Korean business-day boundary and a later-day settlement correction use original timestamps", async () => {
  const before = new Date("2026-09-10T04:59:59+09:00"),
    after = new Date("2026-09-10T05:00:00+09:00");
  const visits = [before, after].map((at) => ({
    id: crypto.randomUUID(),
    tableId,
    joinCode: "123456",
    state: "closed" as const,
    startedAt: at,
    endedAt: at,
  }));
  await db.insert(s.visits).values(visits);
  await db.insert(s.payments).values([
    {
      visitId: visits[0].id,
      tableName: "통계 검증",
      amount: 1000,
      method: "card",
      actor: "검증",
      createdAt: before,
      voidedAt: after,
      voidReason: "수단 변경",
    },
    {
      visitId: visits[1].id,
      tableName: "통계 검증",
      amount: 3000,
      method: "cash",
      actor: "검증",
      createdAt: after,
    },
  ]);
  const previous = await insights(new Date("2026-09-09T05:00:00+09:00"), after);
  const current = await insights(after, new Date("2026-09-11T05:00:00+09:00"));
  expect(previous.revenue).toBe(1000);
  expect(previous.daily).toEqual([{ day: "2026-09-09", revenue: 1000 }]);
  expect(previous.hourly[4].visits).toBe(1);
  expect(current.gross).toBe(3000);
  expect(current.revenue).toBe(2000);
  expect(current.daily).toEqual([{ day: "2026-09-10", revenue: 2000 }]);
  expect(current.hourly[5].visits).toBe(1);
});
