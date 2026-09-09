import { resolve } from "node:path";
import * as fontkit from "@pdf-lib/fontkit";
import { db, schema as s } from "@table/db";
import { createStoreTheme } from "@table/ui/theme";
import { and, asc, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import { assert, requireValue } from "./errors";

const fontBytes = Bun.file(
  resolve(import.meta.dir, "../../..", "assets/fonts/NotoSansKR.ttf"),
).arrayBuffer();
const font = fontBytes.then((bytes) => {
  const base = fontkit.create(new Uint8Array(bytes)) as fontkit.Font & {
    getVariation: (axes: { wght: number }) => fontkit.Font;
  };
  return base.getVariation({ wght: 600 });
});
type Poster = {
  table: typeof s.tables.$inferSelect;
  settings: typeof s.settings.$inferSelect;
  url: string;
};
export async function qrInfo(tableId: string): Promise<Poster> {
  const table = requireValue(
    (
      await db
        .select()
        .from(s.tables)
        .where(and(eq(s.tables.id, tableId), eq(s.tables.archived, false)))
    )[0],
  );
  const [settings] = await db.select().from(s.settings);
  const origin = requireValue(process.env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN을 설정해 주세요.");
  assert(/^https?:\/\//.test(origin), "주문페이지 주소 설정을 확인해 주세요.");
  return { table, settings, url: `${origin.replace(/\/$/, "")}/t/${table.qrToken}` };
}
async function textPath(
  text: string,
  size: number,
  x: number,
  baseline: number,
  color: string,
  maxWidth = 800,
) {
  const f = await font;
  const run = f.layout(text);
  const length = run.positions.reduce((sum, p) => sum + p.xAdvance, 0);
  const scale = Math.min(size / f.unitsPerEm, maxWidth / Math.max(1, length));
  let position = x - (length * scale) / 2;
  return run.glyphs
    .map((glyph, index) => {
      const p = run.positions[index];
      const path = `<path d="${glyph.path.toSVG()}" transform="translate(${position + p.xOffset * scale},${baseline - p.yOffset * scale}) scale(${scale},${-scale})" fill="${color}"/>`;
      position += p.xAdvance * scale;
      return path;
    })
    .join("");
}
const cache = new Map<string, Buffer>();
let jobs = 0;
export async function poster(info: Poster) {
  const key = JSON.stringify([
    info.table.id,
    info.table.name,
    info.settings.name,
    info.settings.logo,
    info.settings.accent,
    info.url,
  ]);
  const previous = cache.get(key);
  if (previous) return previous;
  assert(jobs < 2, "QR 카드를 만들고 있어요. 잠시 후 다시 눌러 주세요.", "PRINT_BUSY", 429);
  jobs++;
  try {
    const qr = await QRCode.toString(info.url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
    });
    const inner = qr
      .replace(/<\?xml[^>]*>/, "")
      .replace("<svg ", '<svg x="226" y="515" width="508" height="508" ');
    const theme = createStoreTheme(info.settings.accent);
    const accent = theme["--primary-text"];
    let logo = "";
    if (/^\/uploads\/[a-f0-9-]+\.webp$/.test(info.settings.logo)) {
      const path = resolve(
        process.env.UPLOAD_DIR ?? "data/uploads",
        info.settings.logo.slice("/uploads/".length),
      );
      if (await Bun.file(path).exists())
        logo = `<image x="398" y="104" width="164" height="96" href="data:image/webp;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}"/>`;
    }
    const paths = await Promise.all([
      textPath(info.settings.name, 34, 480, logo ? 244 : 185, accent),
      textPath("휴대폰으로", 58, 480, 333, theme["--brand-ink"]),
      textPath("편하게 주문하세요", 58, 480, 412, theme["--brand-ink"]),
      textPath("카메라로 아래 QR을 스캔해 주세요", 24, 480, 471, theme["--brand-muted"]),
      textPath(`TABLE ${info.table.name}`, 52, 480, 1113, accent),
      textPath("메뉴 선택  →  주문 확인  →  맛있게 드세요", 24, 480, 1193, theme["--brand-muted"]),
      textPath("결제는 식사 후 매장에서 해주세요", 22, 480, 1260, theme["--brand-muted"]),
    ]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1752" viewBox="0 0 960 1356"><rect width="960" height="1356" fill="#fff"/><rect x="28" y="28" width="904" height="1300" rx="36" fill="${theme["--tint"]}" stroke="${theme["--brand-border"]}" stroke-width="2"/><path d="M54 64h78M64 54v78M828 64h78M896 54v78" stroke="${accent}" stroke-width="3" fill="none"/><rect x="212" y="502" width="536" height="536" rx="18" fill="white"/>${logo}${paths.join("")}${inner}</svg>`;
    const output = await sharp(Buffer.from(svg)).png().toBuffer();
    if (cache.size >= 24) cache.delete(cache.keys().next().value as string);
    cache.set(key, output);
    return output;
  } finally {
    jobs--;
  }
}
export async function qrPdf(tableId?: string) {
  const tableIds = tableId
    ? [tableId]
    : (
        await db
          .select({ id: s.tables.id })
          .from(s.tables)
          .where(eq(s.tables.archived, false))
          .orderBy(asc(s.tables.sort))
      ).map((t) => t.id);
  assert(tableIds.length > 0, "먼저 테이블을 추가해 주세요.");
  assert(tableIds.length <= 300, "전체 출력은 최대 300개 테이블까지 지원해요.");
  const pdf = await PDFDocument.create();
  pdf.setTitle(tableId ? "테이블 주문 QR 카드" : "전체 테이블 주문 QR 카드");
  pdf.setCreator("온기 Table Order");
  for (let i = 0; i < tableIds.length; i++) {
    const info = await qrInfo(tableIds[i]);
    const png = await pdf.embedPng(await poster(info));
    if (tableId) {
      const page = pdf.addPage([297.64, 419.53]);
      page.drawImage(png, { x: 0, y: 0, width: 297.64, height: 419.53 });
    } else {
      const page = i % 4 === 0 ? pdf.addPage([595.28, 841.89]) : pdf.getPages().at(-1);
      if (!page) throw new Error("QR print page missing");
      const width = 268;
      const height = 378.56;
      page.drawImage(png, {
        x: 23 + (i % 2) * 281,
        y: 841.89 - 23 - height - (Math.floor(i / 2) % 2) * 399,
        width,
        height,
      });
    }
  }
  return pdf.save();
}
