import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commandSchema, guestOrderSchema, id, joinSchema, loginSchema } from "@table/contracts";
import { db, schema as s } from "@table/db";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import sharp from "sharp";
import { ZodError } from "zod";
import {
  grantVisit,
  guestAccess,
  guestCookie,
  guestTable,
  login,
  logout,
  owner,
  staff,
  staffCookie,
} from "./auth";
import { beginRequest, finishRequest, processDiagnostics, requestId } from "./diagnostics";
import { AppError, assert } from "./errors";
import { eventStream } from "./events";
import { execute, guestActor, requestResult, submitGuestAtTable } from "./operations";
import { poster, qrInfo, qrPdf } from "./qr";
import { adminSnapshot, guestSnapshot, health, historyVisit, insights } from "./queries";

const origins = new Set([process.env.PUBLIC_ORIGIN, process.env.ADMIN_ORIGIN].filter(Boolean));
const uploadDir = resolve(process.env.UPLOAD_DIR ?? "data/uploads");
sharp.concurrency(1);
let imageJobs = 0;
export const app = new Elysia({ serve: { maxRequestBodySize: 12 * 1024 * 1024, idleTimeout: 30 } })
  .onRequest(({ request, set }) => {
    set.headers["x-request-id"] = beginRequest(request);
  })
  .onAfterResponse(({ request, set }) =>
    finishRequest(request, typeof set.status === "number" ? set.status : 200),
  )
  .onBeforeHandle(({ request, set }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["referrer-policy"] = "same-origin";
    set.headers["cache-control"] = "no-store";
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (
        (origin && !origins.has(origin)) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new AppError(403, "ORIGIN_REJECTED", "다른 사이트에서 보낸 요청이에요.");
      const content = request.headers.get("content-type") ?? "";
      if (!content.startsWith("application/json") && !content.startsWith("multipart/form-data"))
        throw new AppError(415, "CONTENT_TYPE", "지원하지 않는 요청 형식이에요.");
    }
  })
  .onError(({ error, set, code, request }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return { error: error.code, message: error.message };
    }
    if (error instanceof ZodError) {
      set.status = 400;
      return {
        error: "VALIDATION",
        message: "입력 내용을 확인해 주세요.",
        fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "NOT_FOUND", message: "페이지를 찾을 수 없어요." };
    }
    const pg = error as Error & { cause?: { code?: string }; code?: string };
    if (pg.cause?.code === "23505" || pg.code === "23505") {
      set.status = 409;
      return { error: "DUPLICATE", message: "이미 사용 중인 이름이나 번호예요." };
    }
    console.error(
      JSON.stringify({
        level: "error",
        at: new Date().toISOString(),
        code,
        error: pg.name,
        dbCode: pg.cause?.code ?? pg.code,
        requestId: requestId(request),
      }),
    );
    set.status = 503;
    return {
      error: "UNAVAILABLE",
      message: "서버 연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
    };
  })
  .get("/api/health/live", () => ({ ok: true }))
  .get("/api/health/ready", health)
  .post("/api/login", async ({ body, set }) => {
    const input = loginSchema.parse(body);
    set.headers["set-cookie"] = staffCookie(await login(input.login, input.password));
    return { ok: true };
  })
  .post("/api/logout", async ({ request, set }) => {
    await logout(request);
    set.headers["set-cookie"] = staffCookie("", true);
    return { ok: true };
  })
  .get("/api/me", ({ request }) => staff(request))
  .get("/api/admin/snapshot", async ({ request }) => adminSnapshot(await staff(request)))
  .get("/api/admin/diagnostics", async ({ request }) => {
    owner(await staff(request));
    return { ...(await health()), process: processDiagnostics() };
  })
  .post("/api/admin/actions", async ({ request, body }) => {
    const user = await staff(request);
    const input = commandSchema.parse(body);
    return execute(user, input.requestId, input.action);
  })
  .get("/api/admin/requests/:id", async ({ request, params }) => {
    const user = await staff(request);
    return { result: await requestResult(`staff:${user.id}`, id.parse(params.id)) };
  })
  .get("/api/admin/events", async ({ request }) => {
    await staff(request);
    return eventStream(request, null);
  })
  .get("/api/admin/visits/:id", async ({ request, params }) => {
    await staff(request);
    return historyVisit(id.parse(params.id));
  })
  .get("/api/admin/qr/:file/info", async ({ request, params }) => {
    owner(await staff(request));
    const info = await qrInfo(id.parse(params.file));
    return { url: info.url };
  })
  .get("/api/admin/qr/all.pdf", async ({ request, set }) => {
    owner(await staff(request));
    set.headers["content-type"] = "application/pdf";
    set.headers["content-disposition"] = 'attachment; filename="table-order-all.pdf"';
    return new Response(new Uint8Array(await qrPdf()).buffer, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="table-order-all.pdf"',
        "cache-control": "no-store",
      },
    });
  })
  .get("/api/admin/qr/:file", async ({ request, params }) => {
    owner(await staff(request));
    const match = params.file.match(/^([a-f0-9-]{36})\.(pdf|png)$/);
    assert(match, "QR 카드를 찾을 수 없어요.", "NOT_FOUND", 404);
    const tableId = id.parse(match[1]);
    if (match[2] === "pdf")
      return new Response(new Uint8Array(await qrPdf(tableId)).buffer, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="table-order-card.pdf"',
          "cache-control": "no-store",
        },
      });
    return new Response(new Uint8Array(await poster(await qrInfo(tableId))).buffer, {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=0" },
    });
  })
  .get("/api/admin/users", async ({ request }) => {
    owner(await staff(request));
    return db
      .select({
        id: s.users.id,
        login: s.users.login,
        name: s.users.name,
        role: s.users.role,
        active: s.users.active,
      })
      .from(s.users);
  })
  .get("/api/admin/insights", async ({ request, query }) => {
    owner(await staff(request));
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(query.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(query.to ?? ""),
      "조회할 날짜를 선택해 주세요.",
      "VALIDATION",
      400,
    );
    const [settings] = await db.select().from(s.settings).where(eq(s.settings.id, 1));
    const shift = (settings.businessDayStart - 9) * 3600_000;
    const from = new Date(Date.parse(`${query.from}T00:00:00Z`) + shift);
    const until = new Date(Date.parse(`${query.to}T00:00:00Z`) + shift + 86400_000);
    assert(
      Number.isFinite(from.getTime()) &&
        Number.isFinite(until.getTime()) &&
        until > from &&
        until.getTime() - from.getTime() <= 93 * 86400_000,
      "조회 기간은 최대 93일이에요.",
      "VALIDATION",
      400,
    );
    const page = Number(query.page ?? 0);
    assert(
      Number.isInteger(page) && page >= 0 && page <= 10000,
      "페이지 번호를 확인해 주세요.",
      "VALIDATION",
      400,
    );
    return insights(from, until, page);
  })
  .post("/api/admin/images", async ({ request, body }) => {
    owner(await staff(request));
    const file = (body as { file?: unknown }).file;
    assert(
      file instanceof File && file.size > 0 && file.size <= 10 * 1024 * 1024,
      "사진은 10MB 이하 파일로 올려 주세요.",
      "INVALID_IMAGE",
      400,
    );
    assert(imageJobs < 3, "사진을 처리하고 있어요. 잠시 후 다시 올려 주세요.", "IMAGE_BUSY", 429);
    imageJobs++;
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const image = sharp(bytes, { limitInputPixels: 25_000_000 });
      const metadata = await image.metadata().catch(() => {
        throw new AppError(
          400,
          "INVALID_IMAGE",
          "사진을 읽을 수 없어요. JPG, PNG, WebP 파일을 선택해 주세요.",
        );
      });
      assert(
        ["jpeg", "png", "webp", "heif"].includes(metadata.format ?? ""),
        "JPG, PNG, WebP 사진을 올려 주세요.",
        "INVALID_IMAGE",
        400,
      );
      const name = `${crypto.randomUUID()}.webp`;
      await mkdir(uploadDir, { recursive: true });
      const encoded = await image
        .rotate()
        .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
        .catch(() => {
          throw new AppError(
            400,
            "INVALID_IMAGE",
            "사진을 변환할 수 없어요. 다른 JPG, PNG, WebP 파일을 선택해 주세요.",
          );
        });
      await writeFile(resolve(uploadDir, name), encoded, { flag: "wx", mode: 0o644 });
      return { url: `/uploads/${name}` };
    } finally {
      imageJobs--;
    }
  })
  .get("/uploads/:name", ({ params, set }) => {
    assert(/^[a-f0-9-]+\.webp$/.test(params.name), "사진을 찾을 수 없어요.", "NOT_FOUND", 404);
    set.headers["cache-control"] = "public, max-age=31536000, immutable";
    return Bun.file(resolve(uploadDir, params.name));
  })
  .get("/api/guest/:qr/snapshot", async ({ request, params }) => {
    assert(
      /^[a-f0-9]{32}$/.test(params.qr),
      "올바른 테이블 QR로 접속해 주세요.",
      "INVALID_QR",
      404,
    );
    const access = await guestAccess(request, params.qr);
    return guestSnapshot(params.qr, access?.state === "open" ? access.id : null);
  })
  .post("/api/guest/:qr/join", async ({ params, body }) => {
    assert(/^[a-f0-9]{32}$/.test(params.qr), "올바른 QR로 접속해 주세요.", "INVALID_QR", 404);
    joinSchema.parse(body);
    await guestTable(params.qr);
    return { ok: true };
  })
  .post("/api/guest/:qr/orders", async ({ request, params, body, set }) => {
    assert(/^[a-f0-9]{32}$/.test(params.qr), "올바른 QR로 접속해 주세요.", "INVALID_QR", 404);
    const access = await guestAccess(request, params.qr);
    const result = await submitGuestAtTable(
      params.qr,
      guestOrderSchema.parse(body),
      access?.state === "open" ? access.id : undefined,
    );
    if (access?.state !== "open") {
      const visitId = (result.data as { visitId: string }).visitId;
      set.headers["set-cookie"] = guestCookie(params.qr, await grantVisit(visitId));
    }
    return result;
  })
  .get("/api/guest/:qr/requests/:id", async ({ params }) => {
    assert(/^[a-f0-9]{32}$/.test(params.qr), "올바른 QR로 접속해 주세요.", "INVALID_QR", 404);
    return { result: await requestResult(guestActor(params.qr), id.parse(params.id)) };
  })
  .get("/api/guest/:qr/events", async ({ request, params }) => {
    const table = await guestTable(params.qr);
    const access = await guestAccess(request, params.qr);
    return eventStream(
      request,
      { tableId: table.id, visitId: access?.state === "open" ? access.id : undefined },
      Date.now() + 24 * 3600_000,
    );
  });

export type App = typeof app;
