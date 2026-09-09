import { randomInt } from "node:crypto";
import {
  type Action,
  type CommandResult,
  type GuestOrder,
  orderTotal,
  remaining,
  type Staff,
} from "@table/contracts";
import { db, schema as s, type Transaction } from "@table/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { hash, owner, token } from "./auth";
import { assert, requireValue } from "./errors";

type Outcome = { visitId?: string; detail: string; data?: unknown };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function visit(tx: Transaction, id: string, expected?: number) {
  const [row] = await tx.select().from(s.visits).where(eq(s.visits.id, id));
  requireValue(row);
  if (expected !== undefined)
    assert(
      row.version === expected,
      "주문 내역이 바뀌었어요. 최신 내용을 확인해 주세요.",
      "STALE_VERSION",
    );
  return row;
}
async function order(tx: Transaction, id: string, expected?: number) {
  const [row] = await tx.select().from(s.orders).where(eq(s.orders.id, id));
  requireValue(row);
  if (expected !== undefined)
    assert(
      row.version === expected,
      "다른 직원이 먼저 변경했어요. 최신 내용을 확인해 주세요.",
      "STALE_VERSION",
    );
  const v = await visit(tx, row.visitId);
  assert(v.state !== "closed", "종료된 테이블이에요.");
  return { row, visit: v };
}
async function visitItems(tx: Transaction, visitId: string) {
  return tx
    .select({ item: s.items })
    .from(s.items)
    .innerJoin(s.orders, eq(s.orders.id, s.items.orderId))
    .where(eq(s.orders.visitId, visitId))
    .then((rows) => rows.map((r) => r.item));
}
const touchVisit = (tx: Transaction, id: string) =>
  tx
    .update(s.visits)
    .set({ version: sql`${s.visits.version}+1` })
    .where(eq(s.visits.id, id));
const touchOrder = (tx: Transaction, id: string) =>
  tx
    .update(s.orders)
    .set({ version: sql`${s.orders.version}+1` })
    .where(eq(s.orders.id, id));

async function commit(
  requestId: string,
  actor: string,
  body: unknown,
  type: string,
  run: (tx: Transaction) => Promise<Outcome>,
): Promise<CommandResult> {
  const key = `${actor}:${requestId}`;
  const fingerprint = hash(canonical(body));
  return db.transaction(async (tx) => {
    // All business writes take this short per-store lock. Revisions follow COMMIT order,
    // unlike nextval(), so a reconnect cursor cannot skip a late-committing transaction.
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
    const outcome = await run(tx);
    const [state] = await tx
      .update(s.settings)
      .set({ revision: sql`${s.settings.revision}+1` })
      .where(eq(s.settings.id, 1))
      .returning({ revision: s.settings.revision });
    const result: CommandResult = { ok: true, revision: state.revision, data: outcome.data };
    await tx.insert(s.events).values({
      id: state.revision,
      type,
      actor,
      visitId: outcome.visitId ?? null,
      detail: outcome.detail,
    });
    await tx.insert(s.commands).values({ key, actor, requestHash: fingerprint, result });
    return result;
  });
}

async function createOrder(
  tx: Transaction,
  visitId: string,
  input: GuestOrder | Extract<Action, { type: "order.create" }>,
  source: "guest" | "staff",
) {
  const v = await visit(tx, visitId);
  assert(v.state === "open", "정산이 끝난 테이블이에요. 직원에게 문의해 주세요.", "VISIT_ENDED");
  const [settings] = await tx.select().from(s.settings);
  if (source === "guest")
    assert(settings.acceptingOrders, "지금은 주문을 받고 있지 않아요.", "ORDERS_PAUSED");
  const custom = "custom" in input ? input.custom : [];
  const recovery = "recovery" in input ? input.recovery : undefined;
  const orderedAt = recovery ? new Date(recovery.orderedAt) : new Date();
  assert(
    !recovery ||
      (source === "staff" &&
        orderedAt.getTime() <= Date.now() + 60_000 &&
        orderedAt.getTime() >= Date.now() - 7 * 86400_000),
    "사후 입력 시각은 최근 7일 안에서 선택해 주세요.",
    "INVALID_ORDER_TIME",
    400,
  );
  assert(input.lines.length + custom.length > 0, "메뉴를 한 개 이상 선택해 주세요.");
  const rows: (typeof s.items.$inferInsert)[] = [];
  const orderId = crypto.randomUUID();
  const allMenus = input.lines.length
    ? await tx
        .select()
        .from(s.menus)
        .where(
          inArray(
            s.menus.id,
            input.lines.map((l) => l.menuId),
          ),
        )
    : [];
  const allCategories = await tx.select().from(s.categories);
  for (const line of input.lines) {
    const menu = allMenus.find((m) => m.id === line.menuId);
    assert(
      menu && !menu.archived && menu.available && (source === "staff" || menu.visible),
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
      category: allCategories.find((c) => c.id === menu.categoryId)?.name ?? "",
      price: menu.price,
      quantity: line.quantity,
      note: line.note,
    });
  }
  for (const line of custom)
    rows.push({
      orderId,
      name: line.name,
      price: line.price,
      quantity: line.quantity,
      note: line.note,
      category: "직접 추가",
    });
  const total =
    orderTotal(await visitItems(tx, visitId)) +
    rows.reduce((sum, r) => sum + r.price * r.quantity, 0);
  assert(total <= 1_000_000_000, "테이블 주문 금액 한도를 초과했어요.");
  const [created] = await tx
    .insert(s.orders)
    .values({
      id: orderId,
      visitId,
      source,
      note: input.note,
      orderedAt,
      recordedReason: recovery?.reason ?? "",
    })
    .returning();
  await tx.insert(s.items).values(rows.map((row, position) => ({ ...row, position })));
  await touchVisit(tx, visitId);
  return {
    visitId,
    detail: `${created.number}번 주문 · ${rows.reduce((sum, row) => sum + row.quantity, 0)}개${recovery ? ` · 사후 입력 (${recovery.reason}, 실제 주문 ${orderedAt.toISOString()})` : ""}`,
    data: { orderId, number: created.number },
  };
}

export async function submitGuest(visitId: string, input: GuestOrder) {
  return commit(input.requestId, `guest:${visitId}`, input, "order.create", (tx) =>
    createOrder(tx, visitId, input, "guest"),
  );
}
export async function requestResult(actor: string, requestId: string) {
  const [row] = await db
    .select()
    .from(s.commands)
    .where(eq(s.commands.key, `${actor}:${requestId}`));
  return row?.result ?? null;
}

export async function execute(user: Staff, requestId: string, action: Action) {
  const adminOnly = [
    "menu.save",
    "menu.delete",
    "category.save",
    "category.delete",
    "zone.save",
    "zone.delete",
    "table.save",
    "table.delete",
    "settings.save",
    "payment.void",
    "user.save",
  ];
  if (adminOnly.includes(action.type)) owner(user);
  const passwordHash =
    action.type === "user.save" && action.password
      ? await Bun.password.hash(action.password, {
          algorithm: "argon2id",
          memoryCost: 19456,
          timeCost: 2,
        })
      : undefined;
  return commit(requestId, `staff:${user.id}`, action, action.type, async (tx) => {
    const [currentUser] = await tx.select().from(s.users).where(eq(s.users.id, user.id));
    assert(currentUser?.active, "다시 로그인해 주세요.", "UNAUTHORIZED", 401);
    if (adminOnly.includes(action.type)) owner(currentUser);
    switch (action.type) {
      case "menu.save": {
        if (action.categoryId)
          requireValue(
            (
              await tx
                .select()
                .from(s.categories)
                .where(
                  and(eq(s.categories.id, action.categoryId), eq(s.categories.archived, false)),
                )
            )[0],
          );
        assert(
          !action.image || /^\/uploads\/[a-f0-9-]+\.webp$/.test(action.image),
          "업로드한 사진을 선택해 주세요.",
        );
        const { type: _, id, ...values } = action;
        if (id)
          requireValue(
            (
              await tx
                .update(s.menus)
                .set(values)
                .where(and(eq(s.menus.id, id), eq(s.menus.archived, false)))
                .returning()
            )[0],
          );
        else await tx.insert(s.menus).values(values);
        return { detail: `${action.name} 메뉴 저장` };
      }
      case "menu.delete": {
        const [row] = await tx
          .update(s.menus)
          .set({ archived: true, visible: false })
          .where(eq(s.menus.id, action.id))
          .returning();
        return { detail: `${requireValue(row).name} 메뉴 삭제` };
      }
      case "category.save": {
        if (action.id)
          requireValue(
            (
              await tx
                .update(s.categories)
                .set({ name: action.name, sort: action.sort })
                .where(eq(s.categories.id, action.id))
                .returning()
            )[0],
          );
        else await tx.insert(s.categories).values({ name: action.name, sort: action.sort });
        return { detail: `${action.name} 카테고리 저장` };
      }
      case "category.delete": {
        await tx.update(s.menus).set({ categoryId: null }).where(eq(s.menus.categoryId, action.id));
        await tx.update(s.categories).set({ archived: true }).where(eq(s.categories.id, action.id));
        return { detail: "카테고리 삭제 · 메뉴는 미분류로 이동" };
      }
      case "zone.save": {
        if (action.id)
          requireValue(
            (
              await tx
                .update(s.zones)
                .set({ name: action.name })
                .where(eq(s.zones.id, action.id))
                .returning()
            )[0],
          );
        else await tx.insert(s.zones).values({ name: action.name });
        return { detail: `${action.name} 구역 저장` };
      }
      case "zone.delete": {
        await tx.update(s.tables).set({ zoneId: null }).where(eq(s.tables.zoneId, action.id));
        await tx.update(s.zones).set({ archived: true }).where(eq(s.zones.id, action.id));
        return { detail: "구역 삭제 · 테이블은 미지정 구역으로 이동" };
      }
      case "table.save": {
        if (action.zoneId)
          requireValue(
            (
              await tx
                .select()
                .from(s.zones)
                .where(and(eq(s.zones.id, action.zoneId), eq(s.zones.archived, false)))
            )[0],
          );
        const values = { name: action.name, zoneId: action.zoneId, sort: action.sort };
        if (action.id)
          requireValue(
            (
              await tx
                .update(s.tables)
                .set(values)
                .where(and(eq(s.tables.id, action.id), eq(s.tables.archived, false)))
                .returning()
            )[0],
          );
        else await tx.insert(s.tables).values({ ...values, qrToken: token().slice(0, 32) });
        return { detail: `${action.name} 테이블 저장` };
      }
      case "table.delete": {
        const [active] = await tx
          .select()
          .from(s.visits)
          .where(and(eq(s.visits.tableId, action.id), ne(s.visits.state, "closed")));
        assert(!active, "이용 중인 테이블은 삭제할 수 없어요.");
        await tx.update(s.tables).set({ archived: true }).where(eq(s.tables.id, action.id));
        return { detail: "테이블 삭제 · 이전 기록 보존" };
      }
      case "table.clean": {
        const [row] = await tx
          .update(s.tables)
          .set({ state: "empty" })
          .where(and(eq(s.tables.id, action.id), eq(s.tables.state, "cleaning")))
          .returning();
        assert(row, "테이블 상태가 바뀌었어요.");
        return { detail: `${row.name} 정리 완료` };
      }
      case "visit.open": {
        const [table] = await tx
          .select()
          .from(s.tables)
          .where(and(eq(s.tables.id, action.tableId), eq(s.tables.archived, false)));
        requireValue(table);
        assert(table.state === "empty", "이미 사용 중이거나 정리가 필요한 테이블이에요.");
        const [v] = await tx
          .insert(s.visits)
          .values({
            tableId: table.id,
            guests: action.guests,
            joinCode: String(randomInt(100000, 1000000)),
          })
          .returning();
        await tx.update(s.tables).set({ state: "occupied" }).where(eq(s.tables.id, table.id));
        return { visitId: v.id, detail: `${table.name} 손님 받기`, data: { visitId: v.id } };
      }
      case "visit.guests": {
        const v = await visit(tx, action.visitId);
        assert(v.state !== "closed", "종료된 방문이에요.");
        await tx.update(s.visits).set({ guests: action.guests }).where(eq(s.visits.id, v.id));
        await touchVisit(tx, v.id);
        return { visitId: v.id, detail: `인원 ${action.guests ?? "미입력"}` };
      }
      case "visit.move": {
        const v = await visit(tx, action.visitId, action.version);
        assert(v.state !== "closed", "종료된 방문이에요.");
        const [destination] = await tx
          .select()
          .from(s.tables)
          .where(and(eq(s.tables.id, action.tableId), eq(s.tables.archived, false)));
        assert(destination?.state === "empty", "빈 테이블로 이동해 주세요.");
        await tx.update(s.tables).set({ state: "empty" }).where(eq(s.tables.id, v.tableId));
        await tx.update(s.tables).set({ state: "occupied" }).where(eq(s.tables.id, destination.id));
        await tx
          .update(s.visits)
          .set({ tableId: destination.id, version: v.version + 1 })
          .where(eq(s.visits.id, v.id));
        return { visitId: v.id, detail: `${destination.name} 테이블로 이동` };
      }
      case "visit.close": {
        const v = await visit(tx, action.visitId, action.version);
        assert(v.state !== "closed", "이미 종료됐어요.");
        const entries = await visitItems(tx, v.id);
        assert(v.state === "settled" || orderTotal(entries) === 0, "먼저 정산해 주세요.");
        assert(
          entries.every((i) => remaining(i) === 0),
          "아직 나가지 않은 음식이 있어요. 서빙 또는 취소 후 퇴석해 주세요.",
          "UNSERVED_ITEMS",
        );
        await tx
          .update(s.visits)
          .set({ state: "closed", endedAt: new Date(), version: v.version + 1 })
          .where(eq(s.visits.id, v.id));
        await tx.update(s.tables).set({ state: "cleaning" }).where(eq(s.tables.id, v.tableId));
        return { visitId: v.id, detail: "퇴석 · 정리 대기" };
      }
      case "order.create":
        return createOrder(tx, action.visitId, action, "staff");
      case "order.ack": {
        const { row } = await order(tx, action.orderId);
        if (!row.acknowledgedAt) {
          await tx
            .update(s.orders)
            .set({
              acknowledgedAt: new Date(),
              acknowledgedBy: user.name,
              version: row.version + 1,
            })
            .where(eq(s.orders.id, row.id));
          await touchVisit(tx, row.visitId);
        }
        return { visitId: row.visitId, detail: `${row.number}번 주문 확인 · ${user.name}` };
      }
      case "order.serve": {
        const { row } = await order(tx, action.orderId, action.version);
        assert(row.acknowledgedAt, "주문을 먼저 확인해 주세요.");
        const entries = await tx.select().from(s.items).where(eq(s.items.orderId, row.id));
        const quantities = entries
          .filter((i) => remaining(i) > 0)
          .map((i) => ({ itemId: i.id, quantity: remaining(i) }));
        for (const i of entries)
          if (remaining(i))
            await tx
              .update(s.items)
              .set({ served: i.served + remaining(i) })
              .where(eq(s.items.id, i.id));
        await touchOrder(tx, row.id);
        await touchVisit(tx, row.visitId);
        return {
          visitId: row.visitId,
          detail: `${row.number}번 음식 나감 · ${user.name}`,
          data: { undo: { orderId: row.id, version: row.version + 1, quantities } },
        };
      }
      case "item.serve":
      case "item.prepare":
      case "item.cancel": {
        const [item] = await tx.select().from(s.items).where(eq(s.items.id, action.itemId));
        requireValue(item);
        const { row, visit: v } = await order(tx, item.orderId, action.version);
        if (action.type === "item.cancel") {
          assert(v.state === "open", "정산을 정정한 뒤 취소해 주세요.");
          assert(
            action.quantity <= item.quantity - item.cancelled,
            "취소 가능한 수량을 초과했어요.",
          );
          await tx
            .update(s.items)
            .set({ cancelled: item.cancelled + action.quantity })
            .where(eq(s.items.id, item.id));
        } else {
          assert(row.acknowledgedAt, "주문을 먼저 확인해 주세요.");
          const field = action.type === "item.serve" ? "served" : "prepared";
          assert(
            action.quantity <= Math.max(0, item.quantity - item.cancelled - item[field]),
            "남은 수량이 바뀌었어요.",
          );
          await tx
            .update(s.items)
            .set({ [field]: item[field] + action.quantity })
            .where(eq(s.items.id, item.id));
        }
        await touchOrder(tx, row.id);
        await touchVisit(tx, v.id);
        const description =
          action.type === "item.cancel"
            ? `취소 (${action.reason})`
            : action.type === "item.serve"
              ? "음식 나감"
              : "조리 완료";
        return {
          visitId: v.id,
          detail: `${item.name} ${action.quantity}개 ${description} · ${user.name}`,
          data:
            action.type === "item.serve"
              ? {
                  undo: {
                    orderId: row.id,
                    version: row.version + 1,
                    quantities: [{ itemId: item.id, quantity: action.quantity }],
                  },
                }
              : undefined,
        };
      }
      case "serve.undo": {
        const { row } = await order(tx, action.orderId, action.version);
        const recent = await tx
          .select()
          .from(s.commands)
          .where(eq(s.commands.actor, `staff:${user.id}`))
          .orderBy(sql`${s.commands.createdAt} desc`)
          .limit(10);
        const match = recent.find(
          (c) =>
            canonical((c.result.data as { undo?: unknown } | undefined)?.undo) ===
              canonical({
                orderId: action.orderId,
                version: action.version,
                quantities: action.quantities,
              }) && Date.now() - c.createdAt.getTime() < 15000,
        );
        assert(match, "되돌릴 수 있는 시간이 지났거나 상태가 바뀌었어요.");
        for (const q of action.quantities) {
          const [item] = await tx
            .select()
            .from(s.items)
            .where(and(eq(s.items.id, q.itemId), eq(s.items.orderId, row.id)));
          assert(item && item.served >= q.quantity, "현재 수량을 확인해 주세요.");
          await tx
            .update(s.items)
            .set({ served: item.served - q.quantity })
            .where(eq(s.items.id, item.id));
        }
        await touchOrder(tx, row.id);
        await touchVisit(tx, row.visitId);
        return { visitId: row.visitId, detail: `${row.number}번 서빙 되돌리기 · ${user.name}` };
      }
      case "payment.settle": {
        const v = await visit(tx, action.visitId, action.version);
        assert(v.state !== "settled", "이미 정산된 테이블이에요.");
        if (v.state === "closed") owner(user);
        const [existing] = await tx
          .select()
          .from(s.payments)
          .where(and(eq(s.payments.visitId, v.id), sql`${s.payments.voidedAt} is null`));
        assert(!existing, "이미 수납 기록이 있어요.");
        const entries = await visitItems(tx, v.id);
        if (action.close && v.state !== "closed")
          assert(
            entries.every((i) => !remaining(i)),
            "아직 나가지 않은 음식이 있어요. 정산만 하거나, 서빙·취소 후 퇴석해 주세요.",
            "UNSERVED_ITEMS",
          );
        const table = requireValue(
          (await tx.select().from(s.tables).where(eq(s.tables.id, v.tableId)))[0],
        );
        const amount = orderTotal(entries);
        await tx.insert(s.payments).values({
          visitId: v.id,
          amount,
          method: action.method,
          actor: user.name,
          tableName: table.name,
        });
        const closed = action.close || v.state === "closed";
        await tx
          .update(s.visits)
          .set({
            state: closed ? "closed" : "settled",
            version: v.version + 1,
            endedAt: v.endedAt ?? (closed ? new Date() : null),
          })
          .where(eq(s.visits.id, v.id));
        if (closed && v.state !== "closed")
          await tx.update(s.tables).set({ state: "cleaning" }).where(eq(s.tables.id, v.tableId));
        return {
          visitId: v.id,
          detail: `${table.name} ${amount.toLocaleString()}원 수납 기록 · ${user.name}`,
        };
      }
      case "payment.void": {
        const p = requireValue(
          (await tx.select().from(s.payments).where(eq(s.payments.id, action.paymentId)))[0],
        );
        assert(!p.voidedAt, "이미 정정한 기록이에요.");
        await tx
          .update(s.payments)
          .set({ voidedAt: new Date(), voidReason: `${action.reason} · ${user.name}` })
          .where(eq(s.payments.id, p.id));
        const v = await visit(tx, p.visitId);
        await tx
          .update(s.visits)
          .set({ state: v.state === "closed" ? "closed" : "open", version: v.version + 1 })
          .where(eq(s.visits.id, v.id));
        return { visitId: v.id, detail: `수납 기록 정정: ${action.reason} · 실제 환불과 별도` };
      }
      case "settings.save": {
        assert(
          !action.settings.logo || /^\/uploads\/[a-f0-9-]+\.webp$/.test(action.settings.logo),
          "업로드한 로고를 선택해 주세요.",
        );
        await tx.update(s.settings).set(action.settings).where(eq(s.settings.id, 1));
        return { detail: "매장 설정 저장" };
      }
      case "user.save": {
        const owners = await tx
          .select()
          .from(s.users)
          .where(and(eq(s.users.role, "owner"), eq(s.users.active, true)));
        if (owners.some((u) => u.id === action.id) && (!action.active || action.role !== "owner"))
          assert(owners.length > 1, "점주 계정은 한 개 이상 남아 있어야 해요.");
        const values = {
          login: action.login,
          name: action.name,
          role: action.role,
          active: action.active,
        };
        if (action.id) {
          requireValue(
            (
              await tx
                .update(s.users)
                .set({ ...values, ...(passwordHash ? { passwordHash } : {}) })
                .where(eq(s.users.id, action.id))
                .returning()
            )[0],
          );
          await tx.delete(s.sessions).where(eq(s.sessions.userId, action.id));
        } else {
          assert(passwordHash, "새 계정의 비밀번호를 입력해 주세요.");
          await tx.insert(s.users).values({ ...values, passwordHash });
        }
        return { detail: `${action.name} 계정 저장` };
      }
    }
  });
}
