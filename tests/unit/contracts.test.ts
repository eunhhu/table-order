import { describe, expect, test } from "bun:test";
import { guestOrderSchema, orderTotal, remaining } from "@table/contracts";

describe("Order contracts", () => {
  test("KRW totals preserve original prices and partial cancellations", () => {
    expect(
      orderTotal([
        { price: 11000, quantity: 3, cancelled: 1 },
        { price: 2500, quantity: 2, cancelled: 0 },
      ]),
    ).toBe(27000);
  });
  test("a cancellation after serving does not create negative outstanding work", () => {
    expect(remaining({ quantity: 3, cancelled: 2, served: 2 })).toBe(0);
    expect(remaining({ quantity: 3, cancelled: 0, served: 2 })).toBe(1);
  });
  test("an order requires integral positive quantities and explicit expected prices", () => {
    const input = {
      requestId: crypto.randomUUID(),
      lines: [{ menuId: crypto.randomUUID(), quantity: 1.5, expectedPrice: 11000 }],
    };
    expect(guestOrderSchema.safeParse(input).success).toBe(false);
    input.lines[0].quantity = 0;
    expect(guestOrderSchema.safeParse(input).success).toBe(false);
    input.lines[0].quantity = 1;
    expect(guestOrderSchema.safeParse(input).success).toBe(true);
  });
});
