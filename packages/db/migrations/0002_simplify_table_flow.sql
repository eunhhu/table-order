UPDATE "visits"
SET "state" = 'closed', "ended_at" = COALESCE("ended_at", now())
WHERE "state" = 'settled';
--> statement-breakpoint
UPDATE "dining_tables" AS "table"
SET "state" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "visits"
    WHERE "visits"."table_id" = "table"."id" AND "visits"."state" = 'open'
  ) THEN 'occupied'
  ELSE 'empty'
END;
--> statement-breakpoint
UPDATE "settings" SET "pin_required" = false;
