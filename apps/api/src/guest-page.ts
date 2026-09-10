import { randomInt } from "node:crypto";
import { db, schema as s } from "@table/db";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { cookieValue, guestCookie, hash, token } from "./auth";
import { AppError, assert, requireValue } from "./errors";

const GUEST_PAGE_MS = 12 * 3600_000;
export const guestPageHash = (qr: string, key: string) => hash(`${qr}:${key}`);

export function validQr(qr: string) {
  assert(/^[a-f0-9]{32}$/.test(qr), "올바른 테이블 QR로 접속해 주세요.", "INVALID_QR", 404);
}

// Only the QR entry flow mints a credential. A menu page never renews one.
export async function enterGuestPage(qr: string) {
  validQr(qr);
  const key = token();
  const page = guestPageHash(qr, key);
  await db.transaction(async (tx) => {
    // Use the same lock as order/settlement writes, including the grant insert.
    // Starting the visit here also binds devices which have not ordered yet.
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
    let [visit] = await tx
      .select()
      .from(s.visits)
      .where(and(eq(s.visits.tableId, table.id), ne(s.visits.state, "closed")));
    assert(
      !visit || visit.state === "open",
      "직원에게 테이블 상태를 확인해 주세요.",
      "VISIT_ENDED",
    );
    assert(
      table.state !== "cleaning",
      "테이블 정리가 끝나면 다시 스캔해 주세요.",
      "TABLE_NOT_READY",
    );
    if (!visit) {
      [visit] = await tx
        .insert(s.visits)
        .values({ tableId: table.id, joinCode: String(randomInt(100000, 1000000)) })
        .returning();
      await tx.update(s.tables).set({ state: "occupied" }).where(eq(s.tables.id, table.id));
      const [state] = await tx
        .update(s.settings)
        .set({ revision: sql`${s.settings.revision}+1` })
        .where(eq(s.settings.id, 1))
        .returning({ revision: s.settings.revision });
      await tx.insert(s.events).values({
        id: state.revision,
        type: "visit.enter",
        visitId: visit.id,
        actor: `guest-entry:${hash(qr)}`,
        detail: `${table.name} QR로 방문 시작`,
      });
    }
    await tx.insert(s.guests).values({
      tokenHash: page,
      visitId: visit.id,
      expiresAt: new Date(Date.now() + GUEST_PAGE_MS),
    });
  });
  return new Response(null, {
    status: 303,
    headers: {
      location: `/menu/${qr}/${page}`,
      "set-cookie": guestCookie(qr, key),
      "cache-control": "no-store",
      "referrer-policy": "same-origin",
    },
  });
}

export async function guestPageAccess(request: Request, qr: string) {
  validQr(qr);
  const key = cookieValue(request, `guest_${qr}`);
  const page = new URL(request.url).searchParams.get("page") ?? "";
  // The URL contains only a public identifier, never the bearer credential.
  // Pinning it prevents a re-scan in another tab from reviving this old page.
  if (!key || !/^[a-f0-9]{64}$/.test(page) || guestPageHash(qr, key) !== page)
    throw new AppError(401, "SESSION_EXPIRED", "이용이 종료됐어요. 테이블 QR을 다시 스캔해 주세요.");
  const [access] = await db
    .select({ visit: s.visits, expiresAt: s.guests.expiresAt })
    .from(s.guests)
    .innerJoin(s.visits, eq(s.visits.id, s.guests.visitId))
    .where(and(eq(s.guests.tokenHash, page), gt(s.guests.expiresAt, new Date())));
  if (!access)
    throw new AppError(401, "SESSION_EXPIRED", "이용이 종료됐어요. 테이블 QR을 다시 스캔해 주세요.");
  return access;
}
