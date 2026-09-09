import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const pk = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    revision: integer("revision").notNull().default(0),
    name: text("name").notNull().default("테이블 오더"),
    subtitle: text("subtitle").notNull().default("정성껏 준비한 한 끼, 편하게 즐기세요."),
    logo: text("logo").notNull().default(""),
    accent: text("accent").notNull().default("#087F78"),
    categoriesEnabled: boolean("categories_enabled").notNull().default(true),
    acceptingOrders: boolean("accepting_orders").notNull().default(true),
    advancedKitchen: boolean("advanced_kitchen").notNull().default(false),
    pinRequired: boolean("pin_required").notNull().default(false),
    businessDayStart: integer("business_day_start").notNull().default(4),
  },
  (t) => [check("singleton", sql`${t.id} = 1`)],
);
export const users = pgTable(
  "users",
  {
    id: pk(),
    login: text("login").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "staff"] })
      .notNull()
      .default("staff"),
    active: boolean("active").notNull().default(true),
    createdAt: created(),
  },
  (t) => [check("valid_role", sql`${t.role} in ('owner','staff')`)],
);
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
export const zones = pgTable("zones", {
  id: pk(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
});
export const categories = pgTable("categories", {
  id: pk(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
});
export const menus = pgTable(
  "menus",
  {
    id: pk(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    description: text("description").notNull().default(""),
    image: text("image").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id),
    available: boolean("available").notNull().default(true),
    visible: boolean("visible").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
  },
  (t) => [check("menu_price_positive", sql`${t.price} >= 0`)],
);
export const tables = pgTable(
  "dining_tables",
  {
    id: pk(),
    name: text("name").notNull(),
    zoneId: uuid("zone_id").references(() => zones.id),
    sort: integer("sort").notNull().default(0),
    qrToken: text("qr_token").notNull().unique(),
    state: text("state", { enum: ["empty", "occupied", "cleaning"] })
      .notNull()
      .default("empty"),
    archived: boolean("archived").notNull().default(false),
  },
  (t) => [
    check("table_state", sql`${t.state} in ('empty','occupied','cleaning')`),
    uniqueIndex("table_name_live").on(t.name).where(sql`not ${t.archived}`),
  ],
);
export const visits = pgTable(
  "visits",
  {
    id: pk(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    state: text("state", { enum: ["open", "settled", "closed"] })
      .notNull()
      .default("open"),
    guests: integer("guests"),
    joinCode: text("join_code").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("one_active_visit").on(t.tableId).where(sql`${t.state} <> 'closed'`),
    index("visits_started").on(t.startedAt),
    check("visit_state", sql`${t.state} in ('open','settled','closed')`),
    check("guest_count", sql`${t.guests} is null or ${t.guests} between 1 and 99`),
  ],
);
export const guests = pgTable("guest_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => visits.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const orders = pgTable(
  "orders",
  {
    id: pk(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id),
    number: integer("number").notNull().generatedAlwaysAsIdentity(),
    source: text("source", { enum: ["guest", "staff"] }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: created(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
    recordedReason: text("recorded_reason").notNull().default(""),
    acknowledgedBy: text("acknowledged_by"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("orders_visit").on(t.visitId),
    index("orders_ordered").on(t.orderedAt),
    index("orders_pending").on(t.createdAt).where(sql`${t.acknowledgedAt} is null`),
  ],
);
export const items = pgTable(
  "order_items",
  {
    id: pk(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    menuId: uuid("menu_id").references(() => menus.id),
    name: text("name").notNull(),
    category: text("category").notNull().default(""),
    price: integer("price").notNull(),
    quantity: integer("quantity").notNull(),
    cancelled: integer("cancelled").notNull().default(0),
    served: integer("served").notNull().default(0),
    prepared: integer("prepared").notNull().default(0),
    note: text("note").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("items_order").on(t.orderId),
    check(
      "item_quantities",
      sql`${t.quantity} between 1 and 99 and ${t.cancelled} between 0 and ${t.quantity} and ${t.served} between 0 and ${t.quantity} and ${t.prepared} between 0 and ${t.quantity}`,
    ),
    check("item_price", sql`${t.price} >= 0`),
  ],
);
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id),
    tableName: text("table_name").notNull(),
    amount: integer("amount").notNull(),
    method: text("method", { enum: ["card", "cash", "transfer", "other"] }).notNull(),
    actor: text("actor").notNull(),
    createdAt: created(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("one_payment_per_visit").on(t.visitId).where(sql`${t.voidedAt} is null`),
    index("payments_date").on(t.createdAt),
    index("payments_voided").on(t.voidedAt),
    check("payment_amount", sql`${t.amount} >= 0`),
    check("payment_method", sql`${t.method} in ('card','cash','transfer','other')`),
  ],
);
export const events = pgTable(
  "events",
  {
    id: integer("id").primaryKey(),
    type: text("type").notNull(),
    visitId: uuid("visit_id").references(() => visits.id),
    actor: text("actor").notNull(),
    detail: text("detail").notNull(),
    createdAt: created(),
  },
  (t) => [index("events_visit").on(t.visitId), index("events_created").on(t.createdAt)],
);
export const commands = pgTable("commands", {
  key: text("key").primaryKey(),
  actor: text("actor").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").$type<{ ok: true; revision: number; data?: unknown }>().notNull(),
  createdAt: created(),
});
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
