import { z } from "zod";

export const id = z.uuid();
const label = z.string().trim().min(1).max(80);
const note = z.string().trim().max(500).default("");
const money = z.number().int().min(0).max(100_000_000);
const quantity = z.number().int().min(1).max(99);
const version = z.number().int().min(1);
export const loginSchema = z.object({ login: label, password: z.string().min(1).max(200) });
export const orderLineSchema = z.object({ menuId: id, quantity, expectedPrice: money, note });
export const guestOrderSchema = z.object({
  requestId: id,
  lines: z.array(orderLineSchema).min(1).max(50),
  note,
});
export const joinSchema = z.object({ code: z.string().max(12).optional() });
export const settingsSchema = z.object({
  name: label,
  subtitle: z.string().trim().max(120),
  logo: z.string().max(200),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  categoriesEnabled: z.boolean(),
  acceptingOrders: z.boolean(),
  advancedKitchen: z.boolean(),
  pinRequired: z.boolean(),
  businessDayStart: z.number().int().min(0).max(12),
});
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("menu.save"),
    id: id.optional(),
    name: label,
    price: money,
    description: note,
    image: z.string().max(200).default(""),
    categoryId: id.nullable(),
    available: z.boolean(),
    visible: z.boolean(),
    sort: z.number().int().min(0).max(10000),
  }),
  z.object({ type: z.literal("menu.delete"), id }),
  z.object({
    type: z.literal("category.save"),
    id: id.optional(),
    name: label,
    sort: z.number().int().min(0).max(10000),
  }),
  z.object({ type: z.literal("category.delete"), id }),
  z.object({ type: z.literal("zone.save"), id: id.optional(), name: label }),
  z.object({ type: z.literal("zone.delete"), id }),
  z.object({
    type: z.literal("table.save"),
    id: id.optional(),
    name: label,
    zoneId: id.nullable(),
    sort: z.number().int().min(0).max(10000),
  }),
  z.object({ type: z.literal("table.delete"), id }),
  z.object({ type: z.literal("table.clean"), id }),
  z.object({
    type: z.literal("visit.open"),
    tableId: id,
    guests: z.number().int().min(1).max(99).nullable().default(null),
  }),
  z.object({
    type: z.literal("visit.guests"),
    visitId: id,
    guests: z.number().int().min(1).max(99).nullable(),
  }),
  z.object({ type: z.literal("visit.move"), visitId: id, tableId: id, version }),
  z.object({ type: z.literal("visit.close"), visitId: id, version }),
  z.object({
    type: z.literal("order.create"),
    visitId: id,
    lines: z.array(orderLineSchema).max(50),
    custom: z
      .array(z.object({ name: label, price: money, quantity, note }))
      .max(20)
      .default([]),
    recovery: z
      .object({
        orderedAt: z.iso.datetime(),
        reason: z.enum(["연결 장애", "단말 문제", "종이 주문 이관"]),
      })
      .optional(),
    note,
  }),
  z.object({ type: z.literal("order.ack"), orderId: id }),
  z.object({ type: z.literal("order.serve"), orderId: id, version }),
  z.object({ type: z.literal("item.serve"), itemId: id, quantity, version }),
  z.object({ type: z.literal("item.prepare"), itemId: id, quantity, version }),
  z.object({ type: z.literal("item.cancel"), itemId: id, quantity, reason: label, version }),
  z.object({
    type: z.literal("serve.undo"),
    orderId: id,
    version,
    quantities: z
      .array(z.object({ itemId: id, quantity }))
      .min(1)
      .max(70),
  }),
  z.object({
    type: z.literal("payment.settle"),
    visitId: id,
    version,
    method: z.enum(["card", "cash", "transfer", "other"]),
    close: z.boolean(),
  }),
  z.object({ type: z.literal("payment.void"), paymentId: id, reason: label }),
  z.object({ type: z.literal("settings.save"), settings: settingsSchema }),
  z.object({
    type: z.literal("user.save"),
    id: id.optional(),
    login: label,
    name: label,
    role: z.enum(["owner", "staff"]),
    active: z.boolean(),
    password: z.string().min(12).max(200).optional(),
  }),
]);
export const commandSchema = z.object({ requestId: id, action: actionSchema });
export type Action = z.infer<typeof actionSchema>;
export type GuestOrder = z.infer<typeof guestOrderSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type Role = "owner" | "staff";
export interface Staff {
  id: string;
  name: string;
  login: string;
  role: Role;
  active: boolean;
}
export interface Settings extends SettingsInput {
  revision: number;
}
export interface Category {
  id: string;
  name: string;
  sort: number;
}
export interface Zone {
  id: string;
  name: string;
}
export interface Menu {
  id: string;
  name: string;
  price: number;
  description: string;
  image: string;
  categoryId: string | null;
  available: boolean;
  visible: boolean;
  sort: number;
}
export interface Table {
  id: string;
  name: string;
  zoneId: string | null;
  sort: number;
  qrToken: string;
  state: "empty" | "occupied" | "cleaning";
}
export interface Visit {
  id: string;
  tableId: string;
  state: "open" | "settled" | "closed";
  guests: number | null;
  startedAt: string;
  endedAt: string | null;
  version: number;
  joinCode?: string;
  total: number;
}
export interface Item {
  id: string;
  orderId: string;
  menuId: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  cancelled: number;
  served: number;
  prepared: number;
  note: string;
}
export interface Order {
  id: string;
  visitId: string;
  number: number;
  source: "guest" | "staff";
  note: string;
  createdAt: string;
  orderedAt: string;
  recordedReason: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  version: number;
  items: Item[];
}
export interface Payment {
  id: string;
  visitId: string;
  tableName: string;
  amount: number;
  method: "card" | "cash" | "transfer" | "other";
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  actor: string;
}
export interface Activity {
  id: number;
  type: string;
  visitId: string | null;
  actor: string;
  detail: string;
  createdAt: string;
}
export interface AdminSnapshot {
  revision: number;
  settings: Settings;
  staff: Staff;
  tables: Table[];
  visits: Visit[];
  orders: Order[];
  menus: Menu[];
  categories: Category[];
  zones: Zone[];
}
export interface GuestSnapshot {
  revision: number;
  settings: Omit<Settings, "pinRequired" | "advancedKitchen" | "businessDayStart">;
  table: { name: string };
  menus: Menu[];
  categories: Category[];
  visit: Omit<Visit, "joinCode"> | null;
  orders: Order[];
  joined: boolean;
  ended: boolean;
  pinRequired: boolean;
}
export interface CommandResult {
  ok: true;
  revision: number;
  data?: unknown;
}
export interface Insights {
  payments: Payment[];
  paymentCount: number;
  page: number;
  visitRecords: (Omit<Visit, "total" | "joinCode"> & { tableName: string })[];
  activities: Activity[];
  revenue: number;
  gross: number;
  visits: number;
  guests: number;
  unknownGuests: number;
  average: number;
  cancelledAmount: number;
  items: { name: string; quantity: number; cancelled: number; revenue: number }[];
  daily: { day: string; revenue: number }[];
  hourly: { hour: number; visits: number }[];
}
export const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
export const remaining = (item: Pick<Item, "quantity" | "cancelled" | "served">) =>
  Math.max(0, item.quantity - item.cancelled - item.served);
export const orderTotal = (items: Pick<Item, "quantity" | "cancelled" | "price">[]) =>
  items.reduce((sum, item) => sum + (item.quantity - item.cancelled) * item.price, 0);
