ALTER TABLE "order_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ordered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "recorded_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_ordered" ON "orders" USING btree ("ordered_at");--> statement-breakpoint
CREATE INDEX "payments_voided" ON "payments" USING btree ("voided_at");
--> statement-breakpoint
UPDATE orders SET ordered_at = created_at WHERE recorded_reason = '';
