import { randomInt } from "node:crypto";
import {
  type CommandResult,
  type GuestOrder,
  type GuestSnapshot,
  type Order,
  orderTotal,
} from "@table/contracts";
import { db, schema as s, type Transaction } from "@table/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { cookieValue, hash, token } from "./auth";
import { AppError, assert, requireValue } from "./errors";
import { eventStream } from "./events";

const ENTRY_COOKIE = "order_entry";
const ENTRY_TTL_MS = 12 * 60 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;
const endedMessage = "이 주문 세션은 종료됐어요. 테이블의 QR 코드를 다시 스캔해 주세요.";

type Entry = {
  id: string;
  tokenHash: string;
  tableId: string;
  visitId: string | null;
  createdAt: Date;
  expiresAt: Date;
};
type GuestInput = Omit<GuestOrder, "visitId">;
type Outcome = { visitId: string; detail: string; data: unknown };

function validateQr(qr: string) {
  assert(/^[a-f0-9]{32}$/.test(qr), "올바른 테이블 QR로 접속해 주세요.", "INVALID_QR", 404);
}

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const entryFrom = (row: Record<string, unknown>): Entry => ({
  id: String(row.id),
  tokenHash: String(row.tokenHash),
  tableId: String(row.tableId),
  visitId: row.visitId ? String(row.visitId) : null,
  createdAt: asDate(row.createdAt as Date | string),
  expiresAt: asDate(row.expiresAt as Date | string),
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function state(entry: Entry, visitState?: string): "pending" | "open" | "ended" {
  const now = Date.now();
  if (entry.expiresAt.getTime() <= now) return "ended";
  if (entry.visitId) return visitState === "open" ? "open" : "ended";
  return now - entry.createdAt.getTime() < PENDING_TTL_MS ? "pending" : "ended";
}

async function readEntry(tx: Transaction, request: Request, qr: string, entryId: string) {
  validateQr(qr);
  const secret = cookieValue(request, ENTRY_COOKIE);
  if (!secret) throw new AppError(401, "GUEST_SESSION_REQUIRED", endedMessage);
  const rows = await tx.execute(sql`
    select
      ge.id,
      ge.token_hash as "tokenHash",
      ge.table_id as "tableId",
      ge.visit_id as "visitId",
      ge.created_at as "createdAt",
      ge.expires_at as "expiresAt"
    from guest_entries ge
    inner join dining_tables t on t.id = ge.table_id
    where ge.id = ${entryId}
      and ge.token_hash = ${hash(secret)}
      and t.qr_token = ${qr}
      and not t.archived
    limit 1
  `);
  const raw = rows[0] as unknown as Record<string, unknown> | undefined;
  if (!raw) throw new AppError(401, "GUEST_SESSION_REQUIRED", endedMessage);
  const entry = entryFrom(raw);
  const visit = entry.visitId
    ? (await tx.select().from(s.visits).where(eq(s.visits.id, entry.visitId)))[0]
    : undefined;
  return { entry, visit, state: state(entry, visit?.state) };
}

/** Printed /t/:qr is the only browser route that mints a new entry credential. */
export async function enterGuest(qr: string): Promise<Response> {
  validateQr(qr);
  const secret = token();
  const expiresAt = new Date(Date.now() + ENTRY_TTL_MS);
  const entry = await db.transaction(async (tx) => {
    // Serialize the scan against settlement, table moves and first-order creation.
    await tx.select().from(s.settings).where(eq(s.settings.id, 1)).for("update");
    const table = requireValue(
      (
        await tx
          .select()
          .from(s.tables)
          .where(and(eq(s.tables.qrToken, qr), eq(s.tables.archived, false)))
      )[0],
      "사용할 수 없는 테이블 QR이에요.",
    );
    const [visit] = await tx
      .select()
      .from(s.visits)
      .where(and(eq(s.visits.tableId, table.id), ne(s.visits.state, "closed")));
    assert(!visit || visit.state === "open", endedMessage, "VISIT_ENDED", 410);
    // Keep the table small without deleting recently expired rows that may still
    // render a friendly ended state in an already-open tab.
    await tx.execute(sql`delete from guest_entries where expires_at < now() - interval '1 day'`);
    const rows = await tx.execute(sql`
      insert into guest_entries (token_hash, table_id, visit_id, expires_at)
      values (${hash(secret)}, ${table.id}, ${visit?.id ?? null}, ${expiresAt})
      returning
        id,
        token_hash as "tokenHash",
        table_id as "tableId",
        visit_id as "visitId",
        created_at as "createdAt",
        expires_at as "expiresAt"
    `);
    return entryFrom(rows[0] as unknown as Record<string, unknown>);
  });
  const cookiePath = `/api/guest/${qr}/entries/${entry.id}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: `/order/${qr}/${entry.id}`,
      "set-cookie": `${ENTRY_COOKIE}=${secret}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${ENTRY_TTL_MS / 1000}${secure}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

async function orderRows(tx: Transaction, visitId: string): Promise<Order[]> {
  const orders = await tx
    .select()
    .from(s.orders)
    .where(eq(s.orders.visitId, visitId))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.number));
  const items = orders.length
    ? await tx
        .select({ item: s.items })
        .from(s.items)
        .innerJoin(s.orders, eq(s.orders.id, s.items.orderId))
        .where(eq(s.orders.visitId, visitId))
        .orderBy(asc(s.items.position), asc(s.items.id))
    : [];
  const grouped = new Map<string, (typeof s.items.$inferSelect)[]>();
  for (const { item } of items) {
    const group = grouped.get(item.orderId) ?? [];
    group.push(item);
    grouped.set(item.orderId, group);
  }
  return JSON.parse(
    JSON.stringify(orders.map((row) => ({ ...row, items: grouped.get(row.id) ?? [] }))),
  );
}

export async function guestEntrySnapshot(
  request: Request,
  qr: string,
  entryId: string,
): Promise<GuestSnapshot> {
  return db.transaction(
    async (tx) => {
      const access = await readEntry(tx, request, qr, entryId);
      const settings = requireValue(
        (await tx.select().from(s.settings).where(eq(s.settings.id, 1)))[0],
      );
      const openVisit = access.state === "open" ? access.visit : undefined;
      const tableId = openVisit?.tableId ?? access.entry.tableId;
      const table = requireValue(
        (
          await tx
            .select()
            .from(s.tables)
            .where(and(eq(s.tables.id, tableId), eq(s.tables.archived, false)))
        )[0],
      );
      const orders = openVisit ? await orderRows(tx, openVisit.id) : [];
      const menus = await tx
        .select()
        .from(s.menus)
        .where(and(eq(s.menus.archived, false), eq(s.menus.visible, true)))
        .orderBy(asc(s.menus.sort), asc(s.menus.name));
      const categories = await tx
        .select()
        .from(s.categories)
        .where(eq(s.categories.archived, false))
        .orderBy(asc(s.categories.sort));
      const {
        pinRequired: _,
        advancedKitchen: __,
        businessDayStart: ___,
        id: ____,
        ...publicSettings
      } = settings;
      const snapshot = {
        revision: settings.revision,
        settings: {
          ...publicSettings,
          acceptingOrders: access.state === "ended" ? false : publicSettings.acceptingOrders,
        },
        table: { name: table.name },
        menus,
        categories,
        visit: openVisit
          ? {
              id: openVisit.id,
              tableId: openVisit.tableId,
              state: openVisit.state,
              guests: openVisit.guests,
              startedAt: openVisit.startedAt,
              endedAt: openVisit.endedAt,
              version: openVisit.version,
              total: orderTotal(orders.flatMap((order) => order.items)),
            }
          : null,
        orders,
        joined: access.state !== "ended",
        ended: access.state === "ended",
        pinRequired: false,
      };
      return JSON.parse(JSON.stringify(snapshot)) as GuestSnapshot;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function createGuestOrder(
  tx: Transaction,
  visitId: string,
  input: GuestInput,
): Promise<Outcome> {
  const visit = requireValue(
    (await tx.select().from(s.visits).where(eq(s.visits.id, visitId)))[0],
  );
  assert(visit.state === "open", endedMessage, "VISIT_ENDED", 410);
  const settings = requireValue(
    (await tx.select().from(s.settings).where(eq(s.settings.id, 1)))[0],
  );
  assert(settings.acceptingOrders, "지금은 주문을 받고 있지 않아요.", "ORDERS_PAUSED");
  const menus = await tx
    .select()
    .from(s.menus)
    .where(inArray(s.menus.id, input.lines.map((line) => line.menuId)));
  const categories = await tx.select().from(s.categories);
  const orderId = crypto.randomUUID();
  const rows: (typeof s.items.$inferInsert)[] = [];
  for (const line of input.lines) {
    const menu = menus.find((candidate) => candidate.id === line.menuId);
    assert(
      menu && !menu.archived && menu.available && menu.visible,
      "품절되거나 판매가 종료된 메뉴가 있어요. 장바구니를 확인해 주세요.",
      "MENU_CHANGED",
    );
    assert(
      menu.price === line.expectedPrice,
      `${menu.name} 가격이 바뀌었어요. 새 가격을 확인해 주세요.`,
      "PRICE_CHANGED",
    );
    rows.push({
      orderId,
      menuId: menu.id,
      name: menu.name,
      category: categories.find((category) => category.id === menu.categoryId)?.name ?? "",
      price: menu.price,
      quantity: line.quantity,
      note: line.note,
    });
  }
  const [current] = await tx
    .select({
      total:
        sql<number>`coalesce(sum((${s.items.quantity}-${s.items.cancelled})::bigint*${s.items.price}),0)`.mapWith(
          Number,
        ),
    })
    .from(s.items)
    .innerJoin(s.orders, eq(s.orders.id, s.items.orderId))
    .where(eq(s.orders.visitId, visitId));
  const nextTotal = current.total + rows.reduce((sum, row) => sum + row.price * row.quantity, 0);
  assert(nextTotal <= 1_000_000_000, "테이블 주문 금액 한도를 초과했어요.");
  const [created] = await tx
    .insert(s.orders)
    .values({ id: orderId, visitId, source: "guest", note: input.note })
    .returning();
  await tx.insert(s.items).values(rows.map((row, position) => ({ ...row, position })));
  await tx
    .update(s.visits)
    .set({ version: sql`${s.visits.version}+1` })
    .where(eq(s.visits.id, visitId));
  return {
    visitId,
    detail: `${created.number}번 주문 · ${rows.reduce((sum, row) => sum + row.quantity, 0)}개`,
    data: { orderId, number: created.number, visitId },
  };
}

export async function submitGuestEntry(
  request: Request,
  qr: string,
  entryId: string,
  body: GuestOrder,
): Promise<CommandResult> {
  const { visitId: _, ...input } = body;
  const actor = `guest-entry:${entryId}`;
  const key = `${actor}:${input.requestId}`;
  const fingerprint = hash(canonical(input));
  return db.transaction(async (tx) => {
    // Same lock as the existing business command pipeline. Authorization is checked
    // after this lock, so settlement cannot race past an earlier access check.
    await tx.select().from(s.settings).where(eq(s.settings.id, 1)).for("update");
    const [previous] = await tx.select().from(s.commands).where(eq(s.commands.key, key));
    if (previous) {
      assert(
        previous.requestHash === fingerprint,
        "같은 요청 번호의 내용이 달라요.",
        "IDEMPOTENCY_CONFLICT",
      );
      return previous.result;
    }
    const access = await readEntry(tx, request, qr, entryId);
    assert(access.state !== "ended", endedMessage, "VISIT_ENDED", 410);
    let visitId = access.entry.visitId;
    if (!visitId) {
      // An unbound entry was scanned while the table was empty. The first order owns
      // visit creation; all concurrently waiting scans are bound before the lock opens.
      const [alreadyOpen] = await tx
        .select()
        .from(s.visits)
        .where(and(eq(s.visits.tableId, access.entry.tableId), ne(s.visits.state, "closed")));
      assert(!alreadyOpen, endedMessage, "VISIT_ENDED", 410);
      const [visit] = await tx
        .insert(s.visits)
        .values({
          tableId: access.entry.tableId,
          joinCode: String(randomInt(100000, 1000000)),
        })
        .returning();
      visitId = visit.id;
      const now = new Date();
      await tx.execute(sql`
        update guest_entries
        set visit_id = ${visitId}
        where table_id = ${access.entry.tableId}
          and visit_id is null
          and expires_at > ${now}
          and created_at > ${new Date(now.getTime() - PENDING_TTL_MS)}
      `);
      await tx
        .update(s.tables)
        .set({ state: "occupied" })
        .where(eq(s.tables.id, access.entry.tableId));
    }
    const outcome = await createGuestOrder(tx, visitId, input);
    const [revision] = await tx
      .update(s.settings)
      .set({ revision: sql`${s.settings.revision}+1` })
      .where(eq(s.settings.id, 1))
      .returning({ revision: s.settings.revision });
    const result: CommandResult = { ok: true, revision: revision.revision, data: outcome.data };
    await tx.insert(s.events).values({
      id: revision.revision,
      type: "order.create",
      actor,
      visitId: outcome.visitId,
      detail: outcome.detail,
    });
    await tx.insert(s.commands).values({ key, actor, requestHash: fingerprint, result });
    return result;
  });
}

export async function guestEntryRequest(
  request: Request,
  qr: string,
  entryId: string,
  requestId: string,
) {
  await db.transaction((tx) => readEntry(tx, request, qr, entryId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
  const [row] = await db
    .select()
    .from(s.commands)
    .where(eq(s.commands.key, `guest-entry:${entryId}:${requestId}`));
  return { result: row?.result ?? null };
}

export async function guestEntryEvents(request: Request, qr: string, entryId: string) {
  const access = await db.transaction((tx) => readEntry(tx, request, qr, entryId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
  assert(access.state !== "ended", endedMessage, "VISIT_ENDED", 410);
  const deadline = access.entry.visitId
    ? access.entry.expiresAt.getTime()
    : Math.min(
        access.entry.expiresAt.getTime(),
        access.entry.createdAt.getTime() + PENDING_TTL_MS,
      );
  return eventStream(
    request,
    access.entry.visitId ? { visitId: access.entry.visitId } : { tableId: access.entry.tableId },
    deadline,
  );
}
