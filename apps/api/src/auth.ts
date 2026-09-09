import { createHash, randomBytes } from "node:crypto";
import type { Staff } from "@table/contracts";
import { db, schema as s } from "@table/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { AppError, assert, requireValue } from "./errors";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const cookieValue = (request: Request, name: string) => {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));
  return raw?.slice(name.length + 1) ?? "";
};
export const staffCookie = (value: string, clear = false) =>
  `staff_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export const guestCookie = (qr: string, value: string) =>
  `guest_${qr}=${value}; Path=/api/guest/${qr}; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export async function staff(request: Request): Promise<Staff> {
  const key = cookieValue(request, "staff_session");
  if (!key) throw new AppError(401, "UNAUTHORIZED", "로그인이 필요해요.");
  const [row] = await db
    .select({
      id: s.users.id,
      login: s.users.login,
      name: s.users.name,
      role: s.users.role,
      active: s.users.active,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(
      and(
        eq(s.sessions.tokenHash, hash(key)),
        gt(s.sessions.expiresAt, new Date()),
        eq(s.users.active, true),
      ),
    );
  if (!row) throw new AppError(401, "UNAUTHORIZED", "로그인이 만료됐어요. 다시 로그인해 주세요.");
  return row;
}
export function owner(user: Staff) {
  assert(user.role === "owner", "점주 계정으로 사용할 수 있어요.", "FORBIDDEN", 403);
}

async function attempt(key: string, limit: number) {
  const now = new Date();
  const until = new Date(Date.now() + 15 * 60_000);
  const [row] = await db
    .insert(s.rateLimits)
    .values({ key, attempts: 1, expiresAt: until })
    .onConflictDoUpdate({
      target: s.rateLimits.key,
      set: {
        attempts: sql`case when ${s.rateLimits.expiresAt} < ${now.toISOString()} then 1 else ${s.rateLimits.attempts} + 1 end`,
        expiresAt: sql`case when ${s.rateLimits.expiresAt} < ${now.toISOString()} then ${until.toISOString()} else ${s.rateLimits.expiresAt} end`,
      },
    })
    .returning();
  if (row.attempts > limit)
    throw new AppError(429, "TOO_MANY_ATTEMPTS", "시도가 많아요. 잠시 후 다시 해주세요.");
}
const fakeHash = Bun.password.hash("constant-timing-placeholder-not-a-password", {
  algorithm: "argon2id",
  memoryCost: 19456,
  timeCost: 2,
});
export async function login(login: string, password: string) {
  await attempt(`login:${login.toLowerCase()}`, 15);
  const [user] = await db.select().from(s.users).where(eq(s.users.login, login));
  const valid = await Bun.password.verify(password, user?.passwordHash ?? (await fakeHash));
  assert(valid && user?.active, "아이디 또는 비밀번호를 확인해 주세요.", "INVALID_LOGIN", 401);
  const key = token();
  await db.insert(s.sessions).values({
    tokenHash: hash(key),
    userId: user.id,
    expiresAt: new Date(Date.now() + 12 * 3600_000),
  });
  await db.delete(s.rateLimits).where(eq(s.rateLimits.key, `login:${login.toLowerCase()}`));
  return key;
}
export async function logout(request: Request) {
  await db
    .delete(s.sessions)
    .where(eq(s.sessions.tokenHash, hash(cookieValue(request, "staff_session"))));
}
export async function guestAccess(request: Request, qr: string) {
  const value = cookieValue(request, `guest_${qr}`);
  if (!value) return null;
  const [row] = await db
    .select({ visit: s.visits, expiresAt: s.guests.expiresAt })
    .from(s.guests)
    .innerJoin(s.visits, eq(s.visits.id, s.guests.visitId))
    .where(and(eq(s.guests.tokenHash, hash(value)), gt(s.guests.expiresAt, new Date())));
  return row?.visit ?? null;
}
export async function join(qr: string, code?: string) {
  const [table] = await db
    .select()
    .from(s.tables)
    .where(and(eq(s.tables.qrToken, qr), eq(s.tables.archived, false)));
  requireValue(table, "사용할 수 없는 테이블 QR이에요.");
  return db.transaction(async (tx) => {
    // Share the same lock as closing/moving a visit, so a grant cannot race its lifecycle.
    await tx.select().from(s.settings).where(eq(s.settings.id, 1)).for("update");
    const [visit] = await tx
      .select()
      .from(s.visits)
      .where(and(eq(s.visits.tableId, table.id), eq(s.visits.state, "open")));
    assert(visit, "직원이 테이블을 준비하고 있어요. 잠시만 기다려 주세요.", "TABLE_NOT_OPEN");
    const [settings] = await tx.select().from(s.settings);
    if (settings.pinRequired) {
      await attempt(`pin:${visit.id}`, 50);
      assert(code === visit.joinCode, "테이블 입장코드를 확인해 주세요.", "INVALID_CODE", 403);
    }
    const key = token();
    await tx.insert(s.guests).values({
      tokenHash: hash(key),
      visitId: visit.id,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    });
    return key;
  });
}
