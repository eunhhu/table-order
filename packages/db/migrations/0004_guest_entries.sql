CREATE TABLE "guest_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "table_id" uuid NOT NULL,
  "visit_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_entries" ADD CONSTRAINT "guest_entries_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE CASCADE ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_entries" ADD CONSTRAINT "guest_entries_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE CASCADE ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "guest_entries_table_idx" ON "guest_entries" USING btree ("table_id");
--> statement-breakpoint
CREATE INDEX "guest_entries_visit_idx" ON "guest_entries" USING btree ("visit_id");
--> statement-breakpoint
CREATE INDEX "guest_entries_expires_idx" ON "guest_entries" USING btree ("expires_at");
