import { client, db, schema as s } from "@table/db";
import { eq } from "drizzle-orm";

if (process.env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production.");
await db.transaction(async (tx) => {
  await tx.select().from(s.settings).for("update");
  const [exists] = await tx.select().from(s.tables).limit(1);
  if (exists) {
    console.log("Existing tables found; demo seed skipped without modifying data.");
    return;
  }
  const [hall] = await tx.insert(s.zones).values({ name: "메인 홀" }).returning();
  const [terrace] = await tx.insert(s.zones).values({ name: "창가" }).returning();
  for (let i = 1; i <= 12; i++)
    await tx.insert(s.tables).values({
      name: String(i).padStart(2, "0"),
      sort: i,
      zoneId: i > 8 ? terrace.id : hall.id,
      qrToken: crypto.randomUUID().replaceAll("-", ""),
    });
  const cats = await tx
    .insert(s.categories)
    .values([
      { name: "든든한 한 끼", sort: 0 },
      { name: "함께 나눠요", sort: 1 },
      { name: "시원한 한 잔", sort: 2 },
    ])
    .returning();
  await tx.insert(s.menus).values([
    {
      name: "직화 제육 덮밥",
      price: 11000,
      description: "불향 가득한 제육과 아삭한 채소. 따끈한 밥 위에 정성껏 담았어요.",
      categoryId: cats[0].id,
      sort: 0,
    },
    {
      name: "들기름 메밀국수",
      price: 10000,
      description: "고소한 들기름과 향긋한 깻잎, 쫄깃한 메밀면의 만남.",
      categoryId: cats[0].id,
      sort: 1,
    },
    {
      name: "수제 돈카츠 정식",
      price: 13000,
      description: "두툼한 국내산 등심을 바삭하게 튀겨 매일 만드는 소스와 함께.",
      categoryId: cats[0].id,
      sort: 2,
    },
    {
      name: "바삭한 새우튀김",
      price: 8000,
      description: "통통한 새우 4마리, 바삭한 튀김옷과 산뜻한 타르타르 소스.",
      categoryId: cats[1].id,
      sort: 3,
    },
    {
      name: "명란 감자전",
      price: 12000,
      description: "겉은 바삭 속은 촉촉. 짭조름한 명란을 올린 온기 인기 메뉴.",
      categoryId: cats[1].id,
      sort: 4,
    },
    {
      name: "매실 에이드",
      price: 4500,
      description: "상큼한 매실과 톡 쏘는 탄산으로 입안을 깔끔하게.",
      categoryId: cats[2].id,
      sort: 5,
    },
    {
      name: "콜라",
      price: 2500,
      description: "시원하게 준비해 드려요. 355ml",
      categoryId: cats[2].id,
      sort: 6,
    },
  ]);
  await tx.update(s.settings).set({ revision: 1 }).where(eq(s.settings.id, 1));
  await tx.insert(s.events).values({
    id: 1,
    type: "demo.seed",
    actor: "setup",
    detail: "데모 메뉴와 테이블 생성 · 주문/매출 데이터 없음",
  });
  console.log("Demo menu and 12 empty tables created. No fabricated orders or revenue.");
});
await client.end();
