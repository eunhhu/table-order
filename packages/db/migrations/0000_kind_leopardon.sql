CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"key" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"visit_id" uuid,
	"actor" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"visit_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_id" uuid,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"served" integer DEFAULT 0 NOT NULL,
	"prepared" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "item_quantities" CHECK ("order_items"."quantity" between 1 and 99 and "order_items"."cancelled" between 0 and "order_items"."quantity" and "order_items"."served" between 0 and "order_items"."quantity" and "order_items"."prepared" between 0 and "order_items"."quantity"),
	CONSTRAINT "item_price" CHECK ("order_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"category_id" uuid,
	"available" boolean DEFAULT true NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "menu_price_positive" CHECK ("menus"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "payment_amount" CHECK ("payments"."amount" >= 0),
	CONSTRAINT "payment_method" CHECK ("payments"."method" in ('card','cash','transfer','other'))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"name" text DEFAULT '테이블 오더' NOT NULL,
	"subtitle" text DEFAULT '정성껏 준비한 한 끼, 편하게 즐기세요.' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT '#087F78' NOT NULL,
	"categories_enabled" boolean DEFAULT true NOT NULL,
	"accepting_orders" boolean DEFAULT true NOT NULL,
	"advanced_kitchen" boolean DEFAULT false NOT NULL,
	"pin_required" boolean DEFAULT false NOT NULL,
	"business_day_start" integer DEFAULT 4 NOT NULL,
	CONSTRAINT "singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"zone_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"qr_token" text NOT NULL,
	"state" text DEFAULT 'empty' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "dining_tables_qr_token_unique" UNIQUE("qr_token"),
	CONSTRAINT "table_state" CHECK ("dining_tables"."state" in ('empty','occupied','cleaning'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login"),
	CONSTRAINT "valid_role" CHECK ("users"."role" in ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"guests" integer,
	"join_code" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "visit_state" CHECK ("visits"."state" in ('open','settled','closed')),
	CONSTRAINT "guest_count" CHECK ("visits"."guests" is null or "visits"."guests" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_visit" ON "events" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "events_created" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_visit" ON "orders" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "orders_pending" ON "orders" USING btree ("created_at") WHERE "orders"."acknowledged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "one_payment_per_visit" ON "payments" USING btree ("visit_id") WHERE "payments"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "payments_date" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_name_live" ON "dining_tables" USING btree ("name") WHERE not "dining_tables"."archived";--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_visit" ON "visits" USING btree ("table_id") WHERE "visits"."state" <> 'closed';--> statement-breakpoint
CREATE INDEX "visits_started" ON "visits" USING btree ("started_at");
