import { ChargeIntent, Currency } from "@/domain/models/payments";

export type RuleCode =
  | "card_expired"
  | "amount_below_minimum"
  | "amount_above_maximum";

export type RuleViolation = {
  rule: RuleCode;
  message: string;
};

export type ChargeValidation =
  | { valid: true }
  | { valid: false; violations: RuleViolation[] };

// Minimum chargeable amount per currency, in major units
const MINIMUM: Record<Currency, number> = {
  USD: 0.5,
  EUR: 0.5,
  ARS: 100,
};

const MAXIMUM: Record<Currency, number> = {
  USD: 10_000,
  EUR: 10_000,
  ARS: 2_000_000,
};

// A card is valid through the last day of its expiry month
export function checkCardExpiry(
  intent: ChargeIntent,
  now: Date,
): RuleViolation | null {
  const { exp_year, exp_month } = intent.method;
  const expiry = exp_year * 12 + exp_month;
  const current = now.getFullYear() * 12 + (now.getMonth() + 1);

  if (expiry < current) {
    return {
      rule: "card_expired",
      message: `card expired on ${exp_month}/${exp_year}`,
    };
  }

  return null;
}

export function checkAmountLimits(intent: ChargeIntent): RuleViolation | null {
  const amount = Number(intent.amount);
  const minimum = MINIMUM[intent.currency];
  const maximum = MAXIMUM[intent.currency];

  if (amount < minimum) {
    return {
      rule: "amount_below_minimum",
      message: `amount is below the ${minimum} ${intent.currency} minimum`,
    };
  }

  if (amount > maximum) {
    return {
      rule: "amount_above_maximum",
      message: `amount is above the ${maximum} ${intent.currency} maximum`,
    };
  }

  return null;
}

export function validateCharge(
  intent: ChargeIntent,
  now: Date = new Date(),
): ChargeValidation {
  const violations = [
    checkCardExpiry(intent, now),
    checkAmountLimits(intent),
  ].filter((violation): violation is RuleViolation => violation !== null);

  if (violations.length > 0) {
    return { valid: false, violations };
  }

  return { valid: true };
}
