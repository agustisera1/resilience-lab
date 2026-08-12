import { describe, expect, it } from "vitest";
import { getStripeChargeRequest } from "../adapters/payments/stripe-gateway.js";
import { ChargeIntent } from "../domain/models/payments.js";

function anIntent(overrides: Partial<ChargeIntent> = {}): ChargeIntent {
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

describe("getStripeChargeRequest", () => {
  it("renames the fields the processor spells differently", () => {
    expect(getStripeChargeRequest(anIntent())).toEqual({
      amount: 1999,
      currency: "USD",
      customer: "cus_123",
      description: "order 55",
      metadata: { order_id: "55" },
      card: {
        brand: "visa",
        last4: "4242",
        exp_month: 12,
        exp_year: 2030,
      },
    });
  });

  it("converts amounts to integer minor units without float drift", () => {
    // Number("19.99") * 100 is 1998.9999999999998 without the rounding
    expect(getStripeChargeRequest(anIntent({ amount: "19.99" })).amount).toBe(
      1999,
    );
    expect(getStripeChargeRequest(anIntent({ amount: "0.29" })).amount).toBe(
      29,
    );
    expect(getStripeChargeRequest(anIntent({ amount: "1.10" })).amount).toBe(
      110,
    );
    expect(getStripeChargeRequest(anIntent({ amount: "100" })).amount).toBe(
      10000,
    );
  });

  it("drops the fields the processor does not accept", () => {
    const request = getStripeChargeRequest(anIntent());

    expect(request).not.toHaveProperty("idempotency_key");
    expect(request.card).not.toHaveProperty("type");
    expect(request.card).not.toHaveProperty("holder");
  });
});
