UPDATE "visits" AS "visit"
SET "state" = 'closed', "ended_at" = COALESCE("ended_at", now())
WHERE "state" = 'open'
  AND NOT EXISTS (
    SELECT 1
    FROM "orders"
    INNER JOIN "order_items" ON "order_items"."order_id" = "orders"."id"
    WHERE "orders"."visit_id" = "visit"."id"
      AND "order_items"."quantity" > "order_items"."cancelled"
  );
--> statement-breakpoint
UPDATE "dining_tables" AS "table"
SET "state" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "visits"
    WHERE "visits"."table_id" = "table"."id" AND "visits"."state" = 'open'
  ) THEN 'occupied'
  ELSE 'empty'
END;
