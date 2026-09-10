import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Action, AdminSnapshot, GuestOrder, GuestSnapshot, Staff } from "@table/contracts";
import { db, schema as s } from "@table/db";
import { eq, sql } from "drizzle-orm";
import { app } from "../../apps/api/src/app";
import { execute, submitGuest, submitGuestAtTable } from "../../apps/api/src/operations";
import { adminSnapshot, guestSnapshot } from "../../apps/api/src/queries";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test"))
  throw new Error(
    "Integration tests require an isolated *_test database. Run bun scripts/test-db.ts first.",
  );
let user: Staff;
let menuId: string;
let tableId: string;
let qr: string;
let visitId: string;
const command = (action: Action, key = crypto.randomUUID()) => execute(user, key, action);
const basket = (quantity = 2, key = crypto.randomUUID()): GuestOrder => ({
  requestId: key,
  lines: [{ menuId, quantity, expectedPrice: 11000, note: "" }],
  note: "",
});
const snapshot = () => adminSnapshot(user);
beforeAll(async () => {
  app.compile();
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE commands, events, guest_sessions, sessions, order_items, payments, orders, visits, dining_tables, menus, categories, zones, users, rate_limits, settings RESTART IDENTITY CASCADE`,
  );
  await db.insert(s.settings).values({ id: 1 });
  const [owner] = await db
    .insert(s.users)
    .values({
      login: "test-owner",
      name: "테스트 점주",
      role: "owner",
      passwordHash: await Bun.password.hash("TestOwnerPassword2026!"),
    })
    .returning();
  user = { id: owner.id, login: owner.login, name: owner.name, role: owner.role, active: true };
  const [menu] = await db.insert(s.menus).values({ name: "제육 덮밥", price: 11000 }).returning();
  menuId = menu.id;
  qr = crypto.randomUUID().replaceAll("-", "");
  const [table] = await db.insert(s.tables).values({ name: "01", qrToken: qr }).returning();
  tableId = table.id;
  const [visit] = await db.insert(s.visits).values({ tableId, joinCode: "123456" }).returning();
  visitId = visit.id;
  await db.update(s.tables).set({ state: "occupied" }).where(eq(s.tables.id, tableId));
});

describe("durable orders and concurrent restaurant operations", () => {
  test("concurrent first orders create exactly one occupied visit", async () => {
    await command({ type: "visit.close", visitId, version: 1 });
    await Promise.all(Array.from({ length: 20 }, () => submitGuestAtTable(qr, basket(1))));
    const state = await snapshot();
    expect(state.visits).toHaveLength(1);
    expect(state.orders).toHaveLength(20);
    expect(state.tables[0].state).toBe("occupied");
    expect(state.visits[0].total).toBe(220_000);
  });
  test("a rejected first order leaves the table empty without a partial visit", async () => {
    await command({ type: "visit.close", visitId, version: 1 });
    await db.update(s.menus).set({ available: false }).where(eq(s.menus.id, menuId));
    await expect(submitGuestAtTable(qr, basket())).rejects.toThrow("품절");
    const state = await snapshot();
    expect(state.visits).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.tables[0].state).toBe("empty");
  });
  test("the same submission sent concurrently creates one order, and survives a lost response", async () => {
    const input = basket();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => submitGuest(visitId, input)),
    );
    expect(new Set(responses.map((r) => (r.data as { orderId: string }).orderId)).size).toBe(1);
    expect((await snapshot()).orders.length).toBe(1);
    expect(await submitGuest(visitId, input)).toEqual(responses[0]);
  });
  test("the same key cannot be reused for changed quantities", async () => {
    const input = basket();
    await submitGuest(visitId, input);
    await expect(
      submitGuest(visitId, { ...input, lines: [{ ...input.lines[0], quantity: 3 }] }),
    ).rejects.toThrow("같은 요청 번호");
    expect((await snapshot()).visits[0].total).toBe(22000);
  });
  test("100 independent orders are accepted with ZERO receiver terminals and backfilled to a fresh snapshot", async () => {
    await Promise.all(Array.from({ length: 100 }, () => submitGuest(visitId, basket(1))));
    const state = await snapshot();
    expect(state.orders).toHaveLength(100);
    expect(state.visits[0].total).toBe(1_100_000);
    expect(state.orders.every((o) => !o.acknowledgedAt)).toBe(true);
    const guest = await guestSnapshot(qr, visitId, true);
    expect(guest.orders).toHaveLength(100);
  });
  test("menu price changes preserve historical orders and require guest reconfirmation", async () => {
    await submitGuest(visitId, basket());
    await command({
      type: "menu.save",
      id: menuId,
      name: "제육 덮밥",
      price: 13000,
      description: "",
      image: "",
      categoryId: null,
      available: true,
      visible: true,
      sort: 0,
    });
    await expect(submitGuest(visitId, basket())).rejects.toThrow("가격이 바뀌었어요");
    const state = await snapshot();
    expect(state.orders[0].items[0].price).toBe(11000);
    expect(state.visits[0].total).toBe(22000);
  });
  test("sold-out products fail atomically, with no partial order or event", async () => {
    await db.update(s.menus).set({ available: false }).where(eq(s.menus.id, menuId));
    const revision = (await snapshot()).revision;
    await expect(submitGuest(visitId, basket())).rejects.toThrow("품절");
    const state = await snapshot();
    expect(state.orders).toHaveLength(0);
    expect(state.revision).toBe(revision);
  });
  test("concurrent servers cannot serve the same units twice", async () => {
    await submitGuest(visitId, basket());
    let state = await snapshot();
    await command({ type: "order.ack", orderId: state.orders[0].id });
    state = await snapshot();
    const action: Action = {
      type: "item.serve",
      itemId: state.orders[0].items[0].id,
      quantity: 2,
      version: state.orders[0].version,
    };
    const results = await Promise.allSettled([command(action), command(action)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await snapshot()).orders[0].items[0].served).toBe(2);
  });
  test("partial cancellations recalculate amounts and reject stale quantity changes", async () => {
    await submitGuest(visitId, basket(3));
    const state = await snapshot();
    const o = state.orders[0];
    await command({
      type: "item.cancel",
      itemId: o.items[0].id,
      quantity: 1,
      reason: "손님 요청",
      version: o.version,
    });
    expect((await snapshot()).visits[0].total).toBe(22000);
    await expect(
      command({
        type: "item.cancel",
        itemId: o.items[0].id,
        quantity: 3,
        reason: "손님 요청",
        version: o.version,
      }),
    ).rejects.toThrow("다른 직원");
  });
  test("cancelling every ordered item returns the table to empty", async () => {
    await submitGuest(visitId, basket(1));
    const state = await snapshot();
    await command({
      type: "item.cancel",
      itemId: state.orders[0].items[0].id,
      quantity: 1,
      reason: "손님 요청",
      version: state.orders[0].version,
    });
    const after = await snapshot();
    expect(after.visits).toHaveLength(0);
    expect(after.orders).toHaveLength(0);
    expect(after.tables[0].state).toBe("empty");
  });
  test("a new order invalidates an already-open settlement quote", async () => {
    await submitGuest(visitId, basket());
    const quote = (await snapshot()).visits[0];
    await submitGuest(visitId, basket(1));
    await expect(
      command({
        type: "payment.settle",
        visitId,
        version: quote.version,
        method: "card",
        close: false,
      }),
    ).rejects.toThrow("주문 내역이 바뀌었어요");
    expect(await db.select().from(s.payments)).toHaveLength(0);
  });
  test("settlement racing an order has exactly one valid outcome", async () => {
    await submitGuest(visitId, basket());
    const quote = (await snapshot()).visits[0];
    const result = await Promise.allSettled([
      command({
        type: "payment.settle",
        visitId,
        version: quote.version,
        method: "card",
        close: false,
      }),
      submitGuestAtTable(qr, { ...basket(1), visitId }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const state = await snapshot();
    if (state.visits.length) expect(state.visits[0].total).toBe(33000);
    else {
      expect(state.tables[0].state).toBe("empty");
      expect((await db.select().from(s.payments))[0].amount).toBe(22000);
    }
  });
  test("settlement closes the visit and empties the table without a cleaning step", async () => {
    await submitGuest(visitId, basket());
    const state = await snapshot();
    await command({
      type: "payment.settle",
      visitId,
      version: state.visits[0].version,
      method: "cash",
      close: false,
    });
    const after = await snapshot();
    expect(after.visits).toHaveLength(0);
    expect(after.orders).toHaveLength(0);
    expect(after.tables[0].state).toBe("empty");
    expect((await db.select().from(s.visits).where(eq(s.visits.id, visitId)))[0].state).toBe(
      "closed",
    );
  });
  test("serving can be undone through the persisted JSONB result, but not after another change", async () => {
    await submitGuest(visitId, basket());
    let state = await snapshot();
    await command({ type: "order.ack", orderId: state.orders[0].id });
    state = await snapshot();
    const served = await command({
      type: "order.serve",
      orderId: state.orders[0].id,
      version: state.orders[0].version,
    });
    const undo = (served.data as { undo: Omit<Extract<Action, { type: "serve.undo" }>, "type"> })
      .undo;
    await command({ type: "serve.undo", ...undo });
    expect((await snapshot()).orders[0].items[0].served).toBe(0);
    await expect(command({ type: "serve.undo", ...undo })).rejects.toThrow("다른 직원");
  });
  test("moving a visit preserves its history and leaves the printed source QR behind", async () => {
    await submitGuest(visitId, basket());
    const [destination] = await db
      .insert(s.tables)
      .values({ name: "02", qrToken: crypto.randomUUID().replaceAll("-", "") })
      .returning();
    const state = await snapshot();
    await command({
      type: "visit.move",
      visitId,
      tableId: destination.id,
      version: state.visits[0].version,
    });
    const after = await snapshot();
    expect(after.visits[0].tableId).toBe(destination.id);
    expect(after.visits[0].total).toBe(22000);
    expect(after.tables.find((t) => t.id === tableId)?.state).toBe("empty");
    expect((await guestSnapshot(qr, visitId, true)).table.name).toBe("02");
  });
  test("a guest can order immediately after a table becomes empty", async () => {
    await command({ type: "visit.close", visitId, version: (await snapshot()).visits[0].version });
    const result = await submitGuestAtTable(qr, basket());
    const newVisitId = (result.data as { visitId: string }).visitId;
    expect(newVisitId).not.toBe(visitId);
    const current = await guestSnapshot(qr);
    expect(current.joined).toBe(true);
    expect(current.ended).toBe(false);
    expect(current.orders).toHaveLength(1);
    expect(current.visit?.id).toBe(newVisitId);
    expect((await snapshot()).tables[0].state).toBe("occupied");
  });
  test("an owner can reset sales history while preserving store configuration", async () => {
    await submitGuest(visitId, basket());
    await command({ type: "history.reset", confirm: true });
    const state = await snapshot();
    expect(state.tables).toHaveLength(1);
    expect(state.tables[0].state).toBe("empty");
    expect(state.menus).toHaveLength(1);
    expect(state.visits).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(await db.select().from(s.payments)).toHaveLength(0);
    expect(await db.select().from(s.events)).toHaveLength(1);
    await expect(
      execute({ ...user, role: "staff" }, crypto.randomUUID(), {
        type: "history.reset",
        confirm: true,
      }),
    ).rejects.toThrow("점주 계정");
  });
  test("zero heads are never invented for a party with no recorded head count", async () => {
    expect((await snapshot()).visits[0].guests).toBeNull();
  });
  test("used tables cannot be deleted and archived menus keep past orders", async () => {
    await expect(command({ type: "table.delete", id: tableId })).rejects.toThrow("이용 중");
    await submitGuest(visitId, basket());
    await command({ type: "menu.delete", id: menuId });
    const state = await snapshot();
    expect(state.menus).toHaveLength(0);
    expect(state.orders[0].items[0].name).toBe("제육 덮밥");
  });
  test("durable revisions are consecutive and latest state never resurrects completed work", async () => {
    await Promise.all(Array.from({ length: 10 }, () => submitGuest(visitId, basket(1))));
    let state = await snapshot();
    const first = state.orders[0];
    await command({ type: "order.ack", orderId: first.id });
    state = await snapshot();
    await command({ type: "order.serve", orderId: first.id, version: state.orders[0].version });
    const backfill = await snapshot();
    expect(backfill.orders[0].items[0].served).toBe(1);
    const events = await db.select().from(s.events).orderBy(s.events.id);
    expect(events.map((e) => e.id)).toEqual(
      Array.from({ length: backfill.revision }, (_, i) => i + 1),
    );
  });
});

describe("HTTP authorization and request boundary", () => {
  async function request(
    path: string,
    body?: unknown,
    cookie?: string,
    origin = "http://localhost:5173",
  ) {
    return app.handle(
      new Request(`http://localhost:3000${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
  async function ownerCookie() {
    const response = await request("/api/login", {
      login: "test-owner",
      password: "TestOwnerPassword2026!",
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")?.split(";")[0];
  }
  test("anonymous access cannot read staff data or QR assets", async () => {
    expect((await request("/api/admin/snapshot")).status).toBe(401);
    expect((await request(`/api/admin/qr/${tableId}.png`)).status).toBe(401);
  });
  test("a normal login authenticates the real snapshot and rejects unrelated browser origins", async () => {
    const cookie = await ownerCookie();
    expect(cookie).toBeTruthy();
    const loginResponse = await request("/api/login", {
      login: "test-owner",
      password: "TestOwnerPassword2026!",
    });
    expect(loginResponse.headers.get("set-cookie")).toContain("Max-Age=31536000");
    const [session] = await db.select().from(s.sessions).orderBy(sql`${s.sessions.expiresAt} desc`);
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    const response = await request("/api/admin/snapshot", undefined, cookie);
    expect(response.status).toBe(200);
    const state = (await response.json()) as AdminSnapshot;
    expect(state.tables).toHaveLength(1);
    expect(
      (
        await request(
          "/api/admin/actions",
          { requestId: crypto.randomUUID(), action: { type: "table.clean", id: tableId } },
          cookie,
          "https://unrelated.example",
        )
      ).status,
    ).toBe(403);
  });
  test("guest ordering works immediately without joining or any staff receiver", async () => {
    const response = await request(`/api/guest/${qr}/join`, {}, undefined, "http://localhost:5174");
    expect(response.status).toBe(200);
    const result = await request(
      `/api/guest/${qr}/orders`,
      basket(),
      undefined,
      "http://localhost:5174",
    );
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const state = (await (
      await request(`/api/guest/${qr}/snapshot`, undefined, cookie)
    ).json()) as GuestSnapshot;
    expect(state.joined).toBe(true);
    expect(state.orders).toHaveLength(1);
    expect(state.visit).not.toBeNull();
    expect("joinCode" in (state.visit ?? {})).toBe(false);
  });
  test("staff roles cannot change menus or elevate themselves", async () => {
    const employee: Staff = { ...user, role: "staff" };
    await expect(
      execute(employee, crypto.randomUUID(), { type: "menu.delete", id: menuId }),
    ).rejects.toThrow("점주 계정");
  });
});
