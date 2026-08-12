import { describe, expect, it } from "vitest";
import { getChargePayload } from "@/domain/parsing/charge-payload";

function aBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: "req-001",
    customer_id: "cus_123",
    amount: "19.99",
    currency: "USD",
    method: {
      type: "card",
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2030,
      holder: "Agustin Tisera",
    },
    description: "order 55",
    metadata: { order_id: "55" },
    ...overrides,
  };
}

function withCard(overrides: Record<string, unknown>) {
  return aBody({ method: { ...aBody().method, ...overrides } });
}

function errorOf(body: unknown): string {
  const result = getChargePayload(body);
  if (result.ok) throw new Error("expected the payload to be rejected");
  return result.error;
}

describe("getChargePayload", () => {
  it("builds a ChargeIntent from a well formed body", () => {
    const result = getChargePayload(aBody());

    expect(result).toEqual({
      ok: true,
      data: {
        idempotency_key: "req-001",
        customer_id: "cus_123",
        amount: "19.99",
        currency: "USD",
        method: {
          type: "card",
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: 2030,
          holder: "Agustin Tisera",
        },
        description: "order 55",
        metadata: { order_id: "55" },
      },
    });
  });

  it("trims strings and defaults a missing description to null", () => {
    const result = getChargePayload(
      aBody({ customer_id: "  cus_123  ", description: undefined }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.customer_id).toBe("cus_123");
    expect(result.data.description).toBeNull();
    expect(result.data.metadata).toEqual({ order_id: "55" });
  });

  it("rejects anything that is not a plain object", () => {
    expect(errorOf("not a body")).toBe("body must be an object");
    expect(errorOf(null)).toBe("body must be an object");
    expect(errorOf([])).toBe("body must be an object");
  });

  it("rejects missing or blank required fields", () => {
    expect(errorOf(aBody({ idempotency_key: undefined }))).toBe(
      "idempotency_key must be a string",
    );
    expect(errorOf(aBody({ customer_id: "   " }))).toBe(
      "customer_id must not be empty",
    );
  });

  it("rejects an amount that is not a well formed positive decimal", () => {
    expect(errorOf(aBody({ amount: "19.999" }))).toContain("2 decimals");
    expect(errorOf(aBody({ amount: "-5" }))).toContain("2 decimals");
    expect(errorOf(aBody({ amount: "0" }))).toBe(
      "amount must be greater than zero",
    );
  });

  it("rejects an amount sent as a JSON number", () => {
    expect(errorOf(aBody({ amount: 19.99 }))).toBe("amount must be a string");
  });

  it("rejects a currency outside the domain", () => {
    expect(errorOf(aBody({ currency: "BRL" }))).toBe(
      "currency must be one of: USD, EUR, ARS",
    );
  });

  it("reports the field path when the card is wrong", () => {
    expect(errorOf(aBody({ method: undefined }))).toBe(
      "method must be an object",
    );
    expect(errorOf(withCard({ brand: "diners" }))).toBe(
      "method.brand must be one of: visa, mastercard, amex",
    );
    expect(errorOf(withCard({ last4: "42" }))).toBe(
      "method.last4 must be 4 digits",
    );
    expect(errorOf(withCard({ exp_month: 13 }))).toBe(
      "method.exp_month must be between 1 and 12",
    );
    expect(errorOf(withCard({ exp_month: 1.5 }))).toBe(
      "method.exp_month must be an integer",
    );
  });

  it("rejects metadata values that are not strings", () => {
    expect(errorOf(aBody({ metadata: { order_id: 55 } }))).toBe(
      "metadata.order_id must be a string",
    );
  });

  it("rejects a description that is present but not a string", () => {
    expect(errorOf(aBody({ description: 10 }))).toBe(
      "description must be a string",
    );
  });
});
