import { beforeEach, expect, test } from "bun:test";
import type { GuestOrder, Staff } from "@table/contracts";
import { db, schema as s } from "@table/db";
import { eq, sql } from "drizzle-orm";
import { enterGuestPage } from "../../apps/api/src/guest-page";
import { execute, submitGuest } from "../../apps/api/src/operations";
import { adminSnapshot, guestSnapshot } from "../../apps/api/src/queries";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test"))
  throw new Error("Empty-visit tests require an isolated *_test database.");

let user: Staff;
let tableId: string;
let menuId: string;
let qr: string;

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE commands, events, guest_sessions, sessions, order_items, payments, orders, visits, dining_tables, menus, categories, zones, users, rate_limits, settings RESTART IDENTITY CASCADE`,
  );
  await db.insert(s.settings).values({ id: 1 });
  const [employee] = await db
    .insert(s.users)
    .values({
      login: "empty-visit-staff",
      name: "퇴석 담당",
      role: "staff",
      passwordHash: await Bun.password.hash(crypto.randomUUID()),
    })
    .returning();
  user = {
    id: employee.id,
    login: employee.login,
    name: employee.name,
    role: employee.role,
    active: true,
  };
  qr = crypto.randomUUID().replaceAll("-", "");
  const [table] = await db.insert(s.tables).values({ name: "01", qrToken: qr }).returning();
  tableId = table.id;
  // A zero-price order must still invalidate a previously confirmed empty visit.
  const [menu] = await db.insert(s.menus).values({ name: "서비스 메뉴", price: 0 }).returning();
  menuId = menu.id;
});

const basket = (): GuestOrder => ({
  requestId: crypto.randomUUID(),
  lines: [{ menuId, quantity: 1, expectedPrice: 0, note: "" }],
  note: "",
});

async function enter() {
  const response = await enterGuestPage(qr);
  expect(response.status).toBe(303);
  return (await adminSnapshot(user)).visits[0];
}

test("staff can close an orderless QR visit without a payment or a reusable old visit", async () => {
  const first = await enter();
  await execute(user, crypto.randomUUID(), {
    type: "visit.close",
    visitId: first.id,
    version: first.version,
  });
  const closed = await adminSnapshot(user);
  expect(closed.visits).toHaveLength(0);
  expect(closed.orders).toHaveLength(0);
  expect(closed.tables[0].state).toBe("empty");
  expect(await db.select().from(s.payments)).toHaveLength(0);
  const second = await enter();
  expect(second.id).not.toBe(first.id);
  const oldPage = await guestSnapshot(qr, first.id);
  expect(oldPage.ended).toBe(true);
  expect(oldPage.orders).toHaveLength(0);
  await expect(submitGuest(first.id, basket())).rejects.toThrow("정산이 끝난");
  expect((await adminSnapshot(user)).visits[0].id).toBe(second.id);
  expect(await db.select().from(s.orders)).toHaveLength(0);
});

test("a first order invalidates an empty-close confirmation even when its price is zero", async () => {
  const quote = await enter();
  await submitGuest(quote.id, basket());
  await expect(
    execute(user, crypto.randomUUID(), {
      type: "visit.close",
      visitId: quote.id,
      version: quote.version,
    }),
  ).rejects.toThrow("주문 내역이 바뀌었어요");
  const state = await adminSnapshot(user);
  expect(state.visits[0].state).toBe("open");
  expect(state.visits[0].total).toBe(0);
  expect(state.orders).toHaveLength(1);
  expect(await db.select().from(s.payments)).toHaveLength(0);
});

test("an empty-close and first-order race commits exactly one valid outcome", async () => {
  const quote = await enter();
  const outcomes = await Promise.allSettled([
    execute(user, crypto.randomUUID(), {
      type: "visit.close",
      visitId: quote.id,
      version: quote.version,
    }),
    submitGuest(quote.id, basket()),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  const [visit] = await db.select().from(s.visits).where(eq(s.visits.id, quote.id));
  const [table] = await db.select().from(s.tables).where(eq(s.tables.id, tableId));
  const orders = await db.select().from(s.orders).where(eq(s.orders.visitId, quote.id));
  expect(visit.state).toBe(orders.length ? "open" : "closed");
  expect(table.state).toBe(orders.length ? "occupied" : "empty");
  expect(await db.select().from(s.payments)).toHaveLength(0);
});

test("repeating an empty-close command neither records a payment nor duplicates its event", async () => {
  const visit = await enter();
  const requestId = crypto.randomUUID();
  const action = { type: "visit.close" as const, visitId: visit.id, version: visit.version };
  const result = await execute(user, requestId, action);
  expect(await execute(user, requestId, action)).toEqual(result);
  expect(await db.select().from(s.events).where(eq(s.events.type, "visit.close"))).toHaveLength(1);
  expect(await db.select().from(s.payments)).toHaveLength(0);
});
