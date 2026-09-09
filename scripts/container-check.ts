import assert from "node:assert/strict";
import type {
  Action,
  AdminSnapshot,
  CommandResult,
  GuestSnapshot,
  Insights,
} from "@table/contracts";
import sharp from "sharp";

// Deliberately restricted to the disposable Linux installation used by this repository.
if (process.env.PUBLIC_ORIGIN !== "https://ongi.localhost" || process.env.CHECK_ISOLATED !== "yes")
  throw new Error(
    "Run only inside the isolated ongi.localhost deployment, with CHECK_ISOLATED=yes.",
  );
const origin = "http://127.0.0.1:3000";
let staffCookie = "";
async function call<T>(path: string, body?: unknown, cookie = staffCookie): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: "https://ongi.localhost",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  if (path === "/api/login") staffCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return result as T;
}
const act = (action: Action) =>
  call<CommandResult>("/api/admin/actions", { requestId: crypto.randomUUID(), action });
await call("/api/login", {
  login: process.env.ADMIN_LOGIN ?? "owner",
  password: process.env.ADMIN_PASSWORD,
});
const suffix = Date.now().toString(36);
await act({ type: "table.save", name: `검증-${suffix}`, zoneId: null, sort: 1 });
let state = await call<AdminSnapshot>("/api/admin/snapshot");
const table = state.tables.find((t) => t.name === `검증-${suffix}`);
assert(table);
await act({ type: "visit.open", tableId: table.id, guests: null });
const fixture = await sharp({
  create: { width: 160, height: 120, channels: 3, background: "#087f78" },
})
  .png()
  .toBuffer();
const form = new FormData();
form.set("file", new File([new Uint8Array(fixture)], "fixture.png", { type: "image/png" }));
const uploaded = await fetch(`${origin}/api/admin/images`, {
  method: "POST",
  body: form,
  headers: { cookie: staffCookie, origin: "https://ongi.localhost" },
});
assert.equal(uploaded.status, 200);
const image = (await uploaded.json()) as { url: string };
assert.equal((await fetch(`${origin}${image.url}`)).status, 200);
await act({
  type: "menu.save",
  name: `검증메뉴-${suffix}`,
  price: 1000,
  description: "운영 검증용 기록",
  image: image.url,
  categoryId: null,
  available: true,
  visible: true,
  sort: 0,
});
state = await call<AdminSnapshot>("/api/admin/snapshot");
const menu = state.menus.find((m) => m.name === `검증메뉴-${suffix}`);
const visit = state.visits.find((v) => v.tableId === table.id);
assert(menu && visit);
const joined = await fetch(`${origin}/api/guest/${table.qrToken}/join`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://ongi.localhost" },
  body: "{}",
});
assert.equal(joined.status, 200);
const guestCookie = joined.headers.get("set-cookie")?.split(";")[0] ?? "";
const request = {
  requestId: crypto.randomUUID(),
  lines: [{ menuId: menu.id, quantity: 2, expectedPrice: 1000, note: "" }],
  note: "Linux 컨테이너 검증",
};
const result = await call<CommandResult>(
  `/api/guest/${table.qrToken}/orders`,
  request,
  guestCookie,
);
assert.deepEqual(await call(`/api/guest/${table.qrToken}/orders`, request, guestCookie), result);
state = await call<AdminSnapshot>("/api/admin/snapshot");
const order = state.orders.find((o) => o.visitId === visit.id);
assert(order);
await act({
  type: "item.cancel",
  itemId: order.items[0].id,
  quantity: 1,
  version: order.version,
  reason: "손님 요청",
});
await act({ type: "order.ack", orderId: order.id });
state = await call<AdminSnapshot>("/api/admin/snapshot");
const updated = state.orders.find((o) => o.id === order.id);
assert(updated);
await act({ type: "order.serve", orderId: order.id, version: updated.version });
state = await call<AdminSnapshot>("/api/admin/snapshot");
const quote = state.visits.find((v) => v.id === visit.id);
assert(quote);
assert.equal(quote.total, 1000);
await act({
  type: "payment.settle",
  visitId: visit.id,
  version: quote.version,
  method: "card",
  close: true,
});
const guest = await call<GuestSnapshot>(
  `/api/guest/${table.qrToken}/snapshot`,
  undefined,
  guestCookie,
);
assert.equal(guest.ended, true);
assert.equal(guest.orders.length, 0);
const qr = await fetch(`${origin}/api/admin/qr/${table.id}.pdf`, {
  headers: { cookie: staffCookie },
});
assert.equal(qr.status, 200);
assert.equal(qr.headers.get("content-type"), "application/pdf");
const day = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const report = await call<Insights>(`/api/admin/insights?from=${day}&to=${day}`);
assert(report.revenue >= 1000);
console.log(
  JSON.stringify({
    passed: true,
    checks: [
      "owner login",
      "table and menu create",
      "image upload and retrieval",
      "guest join",
      "idempotent guest order",
      "partial cancel",
      "acknowledge",
      "serve",
      "settlement and close",
      "guest expiry",
      "PDF",
      "insights",
    ],
    receipt: 1000,
    fixture: suffix,
  }),
);
