import type { AdminSnapshot, GuestSnapshot, Insights, Order, Staff } from "@table/contracts";
import { orderTotal } from "@table/contracts";
import { db, schema as s, type Transaction } from "@table/db";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { requireValue } from "./errors";

const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value));

async function orderRows(tx: Transaction, visitIds: string[]): Promise<Order[]> {
  if (!visitIds.length) return [];
  const rows = await tx
    .select()
    .from(s.orders)
    .where(inArray(s.orders.visitId, visitIds))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.number));
  const lines = rows.length
    ? await tx
        .select({ item: s.items })
        .from(s.items)
        .innerJoin(s.orders, eq(s.orders.id, s.items.orderId))
        .where(inArray(s.orders.visitId, visitIds))
        .orderBy(asc(s.items.position), asc(s.items.id))
    : [];
  const grouped = new Map<string, (typeof s.items.$inferSelect)[]>();
  for (const { item } of lines) {
    const group = grouped.get(item.orderId) ?? [];
    group.push(item);
    grouped.set(item.orderId, group);
  }
  return json(rows.map((row) => ({ ...row, items: grouped.get(row.id) ?? [] })));
}

export async function adminSnapshot(staff: Staff): Promise<AdminSnapshot> {
  return db.transaction(
    async (tx) => {
      const settings = requireValue((await tx.select().from(s.settings))[0]);
      const tables = await tx
        .select()
        .from(s.tables)
        .where(eq(s.tables.archived, false))
        .orderBy(asc(s.tables.sort), asc(s.tables.name));
      const visits = await tx.select().from(s.visits).where(ne(s.visits.state, "closed"));
      const orders = await orderRows(
        tx,
        visits.map((v) => v.id),
      );
      const menus = await tx
        .select()
        .from(s.menus)
        .where(eq(s.menus.archived, false))
        .orderBy(asc(s.menus.sort), asc(s.menus.name));
      const categories = await tx
        .select()
        .from(s.categories)
        .where(eq(s.categories.archived, false))
        .orderBy(asc(s.categories.sort));
      const zones = await tx
        .select()
        .from(s.zones)
        .where(eq(s.zones.archived, false))
        .orderBy(asc(s.zones.name));
      return json({
        revision: settings.revision,
        settings,
        staff,
        tables,
        visits: visits.map((v) => ({
          ...v,
          total: orderTotal(orders.filter((o) => o.visitId === v.id).flatMap((o) => o.items)),
        })),
        orders,
        menus,
        categories,
        zones,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function guestSnapshot(
  qr: string,
  grantVisitId: string | null = null,
  _hadCookie = false,
): Promise<GuestSnapshot> {
  return db.transaction(
    async (tx) => {
      const [settings] = await tx.select().from(s.settings);
      const {
        pinRequired: _pinRequired,
        advancedKitchen: _advancedKitchen,
        businessDayStart: __,
        id: ___,
        ...publicSettings
      } = settings;
      let table = requireValue(
        (
          await tx
            .select()
            .from(s.tables)
            .where(and(eq(s.tables.qrToken, qr), eq(s.tables.archived, false)))
        )[0],
        "사용할 수 없는 테이블 QR이에요.",
      );
      let v = grantVisitId
        ? (await tx.select().from(s.visits).where(eq(s.visits.id, grantVisitId)))[0]
        : undefined;
      if (v?.state !== "open")
        v = (
          await tx
            .select()
            .from(s.visits)
            .where(and(eq(s.visits.tableId, table.id), eq(s.visits.state, "open")))
        )[0];
      // After the first order, the invisible browser grant follows a moved table.
      if (v?.state === "open")
        table = requireValue(
          (await tx.select().from(s.tables).where(eq(s.tables.id, v.tableId)))[0],
        );
      const orders = v?.state === "open" ? await orderRows(tx, [v.id]) : [];
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
      const safeVisit =
        v?.state === "open"
          ? {
              id: v.id,
              tableId: v.tableId,
              state: v.state,
              guests: v.guests,
              startedAt: v.startedAt,
              endedAt: v.endedAt,
              version: v.version,
              total: orderTotal(orders.flatMap((o) => o.items)),
            }
          : null;
      return json({
        revision: settings.revision,
        settings: publicSettings,
        table: { name: table.name },
        menus,
        categories,
        visit: safeVisit,
        orders,
        joined: true,
        ended: false,
        pinRequired: false,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function historyVisit(id: string) {
  return db.transaction(
    async (tx) => {
      const v = requireValue((await tx.select().from(s.visits).where(eq(s.visits.id, id)))[0]);
      const orders = await orderRows(tx, [id]);
      const payments = await tx
        .select()
        .from(s.payments)
        .where(eq(s.payments.visitId, id))
        .orderBy(desc(s.payments.createdAt));
      const activities = await tx
        .select()
        .from(s.events)
        .where(eq(s.events.visitId, id))
        .orderBy(desc(s.events.id));
      return json({
        visit: { ...v, total: orderTotal(orders.flatMap((o) => o.items)) },
        orders,
        payments,
        activities,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function insights(from: Date, until: Date, page = 0): Promise<Insights> {
  return db.transaction(
    async (tx) => {
      const inPeriod = (
        column:
          | typeof s.payments.createdAt
          | typeof s.payments.voidedAt
          | typeof s.visits.startedAt
          | typeof s.orders.createdAt
          | typeof s.orders.orderedAt,
      ) => and(gte(column, from), lt(column, until));
      const paymentRange = or(inPeriod(s.payments.createdAt), inPeriod(s.payments.voidedAt));
      const payments = await tx
        .select()
        .from(s.payments)
        .where(paymentRange)
        .orderBy(desc(s.payments.createdAt), desc(s.payments.id))
        .limit(100)
        .offset(page * 100);
      const [totals] = await tx
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          soldCount: sql<number>`count(*) filter (where ${inPeriod(s.payments.createdAt)})`.mapWith(
            Number,
          ),
          gross:
            sql<number>`coalesce(sum(${s.payments.amount}::bigint) filter (where ${inPeriod(s.payments.createdAt)}), 0)`.mapWith(
              Number,
            ),
          reversed:
            sql<number>`coalesce(sum(${s.payments.amount}::bigint) filter (where ${inPeriod(s.payments.voidedAt)}), 0)`.mapWith(
              Number,
            ),
        })
        .from(s.payments)
        .where(paymentRange);
      const [visitTotals] = await tx
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          guests: sql<number>`coalesce(sum(${s.visits.guests}),0)`.mapWith(Number),
          unknown: sql<number>`count(*) filter (where ${s.visits.guests} is null)`.mapWith(Number),
        })
        .from(s.visits)
        .where(inPeriod(s.visits.startedAt));
      const visitRecords = await tx
        .select({ visit: s.visits, tableName: s.tables.name })
        .from(s.visits)
        .innerJoin(s.tables, eq(s.tables.id, s.visits.tableId))
        .where(inPeriod(s.visits.startedAt))
        .orderBy(desc(s.visits.startedAt), desc(s.visits.id))
        .limit(100)
        .offset(page * 100);
      // Aggregate inside PostgreSQL: long periods never create one SQL parameter per order,
      // nor load the entire sales history into the API process or the browser.
      const items = await tx
        .select({
          name: s.items.name,
          menuId: s.items.menuId,
          quantity: sql<number>`sum(${s.items.quantity} - ${s.items.cancelled})`.mapWith(Number),
          cancelled: sql<number>`sum(${s.items.cancelled})`.mapWith(Number),
          revenue:
            sql<number>`sum((${s.items.quantity}-${s.items.cancelled})::bigint*${s.items.price})`.mapWith(
              Number,
            ),
          cancelledAmount: sql<number>`sum(${s.items.cancelled}::bigint*${s.items.price})`.mapWith(
            Number,
          ),
        })
        .from(s.items)
        .innerJoin(s.orders, eq(s.orders.id, s.items.orderId))
        .where(inPeriod(s.orders.orderedAt))
        .groupBy(s.items.menuId, s.items.name);
      const activities = await tx
        .select()
        .from(s.events)
        .where(and(gte(s.events.createdAt, from), lt(s.events.createdAt, until)))
        .orderBy(desc(s.events.id))
        .limit(100);
      const [settings] = await tx.select().from(s.settings);
      const dailyRows = await tx.execute(sql`
        select to_char(recorded_at at time zone 'Asia/Seoul' - (${settings.businessDayStart} * interval '1 hour'), 'YYYY-MM-DD') as day, sum(amount)::text as revenue
        from (
          select created_at recorded_at, amount::bigint amount from payments where ${inPeriod(s.payments.createdAt)}
          union all
          select voided_at recorded_at, -amount::bigint amount from payments where ${inPeriod(s.payments.voidedAt)}
        ) entries group by day order by day
      `);
      const hour =
        sql<number>`extract(hour from ${s.visits.startedAt} at time zone 'Asia/Seoul')`.mapWith(
          Number,
        );
      const hours = await tx
        .select({ hour, visits: sql<number>`count(*)`.mapWith(Number) })
        .from(s.visits)
        .where(inPeriod(s.visits.startedAt))
        .groupBy(hour);
      const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }));
      for (const h of hours) hourly[h.hour].visits = h.visits;
      return json({
        payments,
        paymentCount: totals.count,
        page,
        visitRecords: visitRecords.map(({ visit: { joinCode: _, ...v }, tableName }) => ({
          ...v,
          tableName,
        })),
        activities,
        revenue: totals.gross - totals.reversed,
        gross: totals.gross,
        visits: visitTotals.count,
        guests: visitTotals.guests,
        unknownGuests: visitTotals.unknown,
        average: totals.soldCount ? Math.round(totals.gross / totals.soldCount) : 0,
        cancelledAmount: items.reduce((sum, i) => sum + i.cancelledAmount, 0),
        items: items
          .map((i) => ({ ...i, name: i.menuId ? i.name : `${i.name} (직접 추가)` }))
          .sort((a, b) => b.quantity - a.quantity),
        daily: dailyRows.map((row) => ({ day: String(row.day), revenue: Number(row.revenue) })),
        hourly,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function health() {
  // Readiness checks the current additive schema, not merely the database socket.
  await db.execute(
    sql`select o.ordered_at, o.recorded_reason, i.position from orders o join order_items i on i.order_id = o.id limit 0`,
  );
  const [settings] = await db
    .select({ id: s.settings.id })
    .from(s.settings)
    .where(eq(s.settings.id, 1));
  requireValue(settings, "매장 설정을 확인하고 있어요.");
  return { ok: true };
}
