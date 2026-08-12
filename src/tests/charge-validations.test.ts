import { describe, expect, it } from "vitest";
import { ChargeIntent } from "../domain/models/payments.js";
import {
  checkAmountLimits,
  checkCardExpiry,
  validateCharge,
} from "../domain/validations/payments.js";

// Local time on purpose: the rule reads getFullYear/getMonth
const NOW = new Date(2026, 7, 11); // August 11th, 2026

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
    description: null,
    ...overrides,
  };
}

function withCard(exp_month: number, exp_year: number): ChargeIntent {
  const intent = anIntent();
  return { ...intent, method: { ...intent.method, exp_month, exp_year } };
}

describe("checkCardExpiry", () => {
  it("lets a card through on its very expiry month", () => {
    expect(checkCardExpiry(withCard(8, 2026), NOW)).toBeNull();
  });

  it("flags a card that expired the month before", () => {
    expect(checkCardExpiry(withCard(7, 2026), NOW)).toEqual({
      rule: "card_expired",
      message: "card expired on 7/2026",
    });
  });

  it("flags a card that expired in a previous year", () => {
    expect(checkCardExpiry(withCard(12, 2025), NOW)?.rule).toBe("card_expired");
  });

  it("lets a future card through", () => {
    expect(checkCardExpiry(withCard(1, 2030), NOW)).toBeNull();
  });
});

describe("checkAmountLimits", () => {
  it("flags an amount below the currency minimum", () => {
    expect(checkAmountLimits(anIntent({ amount: "0.49" }))?.rule).toBe(
      "amount_below_minimum",
    );
  });

  it("accepts exactly the minimum", () => {
    expect(checkAmountLimits(anIntent({ amount: "0.50" }))).toBeNull();
  });

  it("flags an amount above the currency maximum", () => {
    expect(checkAmountLimits(anIntent({ amount: "10000.01" }))?.rule).toBe(
      "amount_above_maximum",
    );
  });

  it("accepts exactly the maximum", () => {
    expect(checkAmountLimits(anIntent({ amount: "10000" }))).toBeNull();
  });

  it("uses the thresholds of the currency it was given", () => {
    // 99 clears the USD minimum but not the ARS one
    expect(
      checkAmountLimits(anIntent({ amount: "99", currency: "USD" })),
    ).toBeNull();

    expect(
      checkAmountLimits(anIntent({ amount: "99", currency: "ARS" }))?.rule,
    ).toBe("amount_below_minimum");

    expect(
      checkAmountLimits(anIntent({ amount: "100", currency: "ARS" })),
    ).toBeNull();
  });
});

describe("validateCharge", () => {
  it("passes a well formed intent", () => {
    expect(validateCharge(anIntent(), NOW)).toEqual({ valid: true });
  });

  it("collects every violation instead of stopping at the first", () => {
    const intent = anIntent({ amount: "0.10" });
    const expired = { ...intent, method: { ...intent.method, exp_month: 1, exp_year: 2020 } };

    const result = validateCharge(expired, NOW);

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "card_expired",
      "amount_below_minimum",
    ]);
  });

  it("falls back to the current date when now is omitted", () => {
    const result = validateCharge(withCard(1, 2020));

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(result.violations[0].rule).toBe("card_expired");
  });
});
