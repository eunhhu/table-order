import { beforeAll, beforeEach, expect, test } from "bun:test";
import type { GuestSnapshot, Staff } from "@table/contracts";
import { db, schema as s } from "@table/db";
import { eq, sql } from "drizzle-orm";
import { app } from "../../apps/api/src/app";
import { guestPageHash } from "../../apps/api/src/guest-page";
import { execute } from "../../apps/api/src/operations";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test"))
  throw new Error("Guest page tests require an isolated *_test database.");

type Page = { qr: string; page: string; cookie: string };
let user: Staff;
let qr: string;
let tableId: string;
let menuId: string;
const basket = () => ({
  requestId: crypto.randomUUID(),
  lines: [{ menuId, quantity: 1, expectedPrice: 1000, note: "" }],
  note: "",
});

beforeAll(() => {
  app.compile();
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE commands, events, guest_sessions, sessions, order_items, payments, orders, visits, dining_tables, menus, categories, zones, users, rate_limits, settings RESTART IDENTITY CASCADE`,
  );
  await db.insert(s.settings).values({ id: 1 });
  const [owner] = await db
    .insert(s.users)
    .values({ login: "page-owner", name: "테스트 점주", role: "owner", passwordHash: "unused" })
    .returning();
  user = { id: owner.id, login: owner.login, name: owner.name, role: "owner", active: true };
  qr = crypto.randomUUID().replaceAll("-", "");
  const [table] = await db.insert(s.tables).values({ name: "01", qrToken: qr }).returning();
  tableId = table.id;
  const [menu] = await db.insert(s.menus).values({ name: "테스트 메뉴", price: 1000 }).returning();
  menuId = menu.id;
});

async function enter(value = qr): Promise<Page> {
  const response = await app.handle(new Request(`http://localhost:3000/api/guest/${value}/enter`));
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(cookie).not.toBe("");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  const location = response.headers.get("location") ?? "";
  expect(location).toMatch(new RegExp(`^/menu/${value}/[a-f0-9]{64}$`));
  const page = location.split("/").at(-1) ?? "";
  expect(page).toBe(guestPageHash(value, cookie.split("=")[1]));
  expect(location).not.toContain(cookie.split("=")[1]);
  return { qr: value, page, cookie };
}
function request(page: Page, path: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost:3000/api/guest/${page.qr}/${path}?page=${page.page}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: page.cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function snapshot(page: Page): Promise<GuestSnapshot> {
  const response = await request(page, "snapshot");
  expect(response.status).toBe(200);
  return response.json();
}
async function settle(page: Page) {
  const visit = (await snapshot(page)).visit;
  if (!visit) throw new Error("Expected an active visit");
  await execute(user, crypto.randomUUID(), {
    type: "payment.settle",
    visitId: visit.id,
    version: visit.version,
    method: "cash",
    close: true,
  });
}

test("simultaneous scans share one visit before any device orders", async () => {
  const pages = await Promise.all(Array.from({ length: 6 }, () => enter()));
  const states = await Promise.all(pages.map(snapshot));
  expect(new Set(states.map((state) => state.visit?.id)).size).toBe(1);
  expect(states.every((state) => state.joined && state.orders.length === 0)).toBe(true);
  expect(await db.select().from(s.visits)).toHaveLength(1);
  expect(await db.select().from(s.guests)).toHaveLength(6);
  expect(await db.select().from(s.events)).toHaveLength(1);
  expect((await db.select().from(s.tables))[0].state).toBe("occupied");
});

test("settled pages cannot read or add to the next party, or mint replacement grants", async () => {
  const a = await enter();
  expect((await request(a, "orders", basket())).status).toBe(200);
  await settle(a);
  const b = await enter();
  expect((await request(b, "orders", basket())).status).toBe(200);
  const before = await snapshot(b);
  const old = await snapshot(a);
  expect(old.ended).toBe(true);
  expect(old.joined).toBe(false);
  expect(old.visit).toBeNull();
  expect(old.orders).toHaveLength(0);
  const rejected = await request(a, "orders", basket());
  expect(rejected.status).toBe(410);
  expect(rejected.headers.get("set-cookie")).toBeNull();
  expect((await request(a, "events")).status).toBe(410);
  expect((await snapshot(b)).orders).toEqual(before.orders);
  expect(await db.select().from(s.guests)).toHaveLength(2);
});

test("a never-delivered first order cannot cross a visit boundary", async () => {
  const a = await enter();
  const pending = basket();
  const visit = (await snapshot(a)).visit;
  if (!visit) throw new Error("Expected an active visit");
  await execute(user, crypto.randomUUID(), {
    type: "visit.close",
    visitId: visit.id,
    version: visit.version,
  });
  const b = await enter();
  expect((await request(a, "orders", pending)).status).toBe(410);
  expect((await snapshot(b)).orders).toHaveLength(0);
});

test("a new cookie in the same browser does not revive an old menu page", async () => {
  const old = await enter();
  await settle(old);
  const fresh = await enter();
  const staleTab = { ...old, cookie: fresh.cookie };
  expect((await request(staleTab, "snapshot")).status).toBe(401);
  expect((await request(staleTab, "orders", basket())).status).toBe(401);
  expect((await snapshot(fresh)).orders).toHaveLength(0);
});

test("expired or absent credentials fail closed instead of silently joining", async () => {
  const page = await enter();
  await db
    .update(s.guests)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(s.guests.tokenHash, page.page));
  for (const candidate of [page, { ...page, cookie: "" }]) {
    expect((await request(candidate, "snapshot")).status).toBe(401);
    expect((await request(candidate, "orders", basket())).status).toBe(401);
    expect((await request(candidate, `requests/${crypto.randomUUID()}`)).status).toBe(401);
  }
  expect(await db.select().from(s.orders)).toHaveLength(0);
  expect(await db.select().from(s.guests)).toHaveLength(1);
});

test("menu APIs require the page binding even when a cookie exists", async () => {
  const page = await enter();
  const response = await app.handle(
    new Request(`http://localhost:3000/api/guest/${qr}/snapshot`, {
      headers: { cookie: page.cookie },
    }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("the visit in the credential, not the request body, owns the order", async () => {
  const a = await enter();
  const otherQr = crypto.randomUUID().replaceAll("-", "");
  await db.insert(s.tables).values({ name: "02", qrToken: otherQr });
  const b = await enter(otherQr);
  const other = (await snapshot(b)).visit;
  expect((await request(a, "orders", { ...basket(), visitId: other?.id })).status).toBe(200);
  expect((await snapshot(a)).orders).toHaveLength(1);
  expect((await snapshot(b)).orders).toHaveLength(0);
});

test("a moved party keeps its grant without following the source table's new party", async () => {
  const a = await enter();
  const v = (await snapshot(a)).visit;
  if (!v) throw new Error("Expected an active visit");
  const [destination] = await db
    .insert(s.tables)
    .values({ name: "02", qrToken: crypto.randomUUID().replaceAll("-", "") })
    .returning();
  await execute(user, crypto.randomUUID(), {
    type: "visit.move",
    visitId: v.id,
    version: v.version,
    tableId: destination.id,
  });
  const nextAtSource = await enter();
  expect((await request(a, "orders", basket())).status).toBe(200);
  const moved = await snapshot(a);
  expect(moved.visit?.id).toBe(v.id);
  expect(moved.table.name).toBe("02");
  expect((await snapshot(nextAtSource)).visit?.tableId).toBe(tableId);
  expect((await snapshot(nextAtSource)).orders).toHaveLength(0);
});

test("grant hashes are QR-bound, independently of the cookie name", async () => {
  const a = await enter();
  const otherQr = crypto.randomUUID().replaceAll("-", "");
  await db.insert(s.tables).values({ name: "02", qrToken: otherQr });
  const key = a.cookie.split("=")[1];
  const differentScope = {
    qr: otherQr,
    cookie: `guest_${otherQr}=${key}`,
    page: guestPageHash(otherQr, key),
  };
  expect((await request(differentScope, "snapshot")).status).toBe(401);
});

test("durable retries remain idempotent and results stay scoped after settlement", async () => {
  const a = await enter();
  const input = basket();
  const first = await (await request(a, "orders", input)).json();
  expect(await (await request(a, "orders", input)).json()).toEqual(first);
  expect(await db.select().from(s.orders)).toHaveLength(1);
  await settle(a);
  const b = await enter();
  const found = await (await request(a, `requests/${input.requestId}`)).json();
  const missing = await (await request(b, `requests/${input.requestId}`)).json();
  expect(found.result).toEqual(first);
  expect(missing.result).toBeNull();
  expect((await request(a, "orders", basket())).status).toBe(410);
  expect((await snapshot(b)).orders).toHaveLength(0);
});

test("HTTP orders racing settlement cannot create a replacement visit", async () => {
  const page = await enter();
  expect((await request(page, "orders", basket())).status).toBe(200);
  const visit = (await snapshot(page)).visit;
  if (!visit) throw new Error("Expected an active visit");
  const [payment, order] = await Promise.allSettled([
    execute(user, crypto.randomUUID(), {
      type: "payment.settle",
      visitId: visit.id,
      version: visit.version,
      method: "cash",
      close: true,
    }),
    request(page, "orders", basket()),
  ]);
  const paymentSucceeded = payment.status === "fulfilled";
  const orderSucceeded = order.status === "fulfilled" && order.value.status === 200;
  expect(Number(paymentSucceeded) + Number(orderSucceeded)).toBe(1);
  expect(await db.select().from(s.visits)).toHaveLength(1);
  expect(await db.select().from(s.orders)).toHaveLength(paymentSucceeded ? 1 : 2);
});
