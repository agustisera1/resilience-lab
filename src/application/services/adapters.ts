import {
  CardBrand,
  ChargeIntent,
  Currency,
  PaymentMethod,
} from "../../domain/models/payments";

export type ParsedPayload<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CURRENCIES: readonly Currency[] = ["USD", "EUR", "ARS"];
const CARD_BRANDS: readonly CardBrand[] = ["visa", "mastercard", "amex"];
const METHOD_TYPES: readonly PaymentMethod["type"][] = ["card"];

// Positive decimal, up to two fraction digits
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const LAST4 = /^\d{4}$/;

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) fail(`${field} must not be empty`);
  return trimmed;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  if (value < min || value > max) {
    fail(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function option<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): T {
  const raw = text(value, field);
  if (!options.includes(raw as T)) {
    fail(`${field} must be one of: ${options.join(", ")}`);
  }
  return raw as T;
}

function money(value: unknown, field: string): string {
  const raw = text(value, field);
  if (!AMOUNT.test(raw)) {
    fail(`${field} must be a decimal amount with up to 2 decimals`);
  }
  if (Number(raw) <= 0) fail(`${field} must be greater than zero`);
  return raw;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return text(value, field);
}

function stringMap(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const map = record(value, field);

  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry !== "string") fail(`${field}.${key} must be a string`);
  }

  return map as Record<string, string>;
}

function pattern(
  value: unknown,
  regex: RegExp,
  field: string,
  hint: string,
): string {
  const raw = text(value, field);
  if (!regex.test(raw)) fail(`${field} ${hint}`);
  return raw;
}

function getPaymentMethod(value: unknown): PaymentMethod {
  const method = record(value, "method");

  return {
    type: option(method.type, METHOD_TYPES, "method.type"),
    brand: option(method.brand, CARD_BRANDS, "method.brand"),
    last4: pattern(method.last4, LAST4, "method.last4", "must be 4 digits"),
    exp_month: integer(method.exp_month, "method.exp_month", 1, 12),
    exp_year: integer(method.exp_year, "method.exp_year", 2000, 2099),
    holder: text(method.holder, "method.holder"),
  };
}

export function getChargePayload(body: unknown): ParsedPayload<ChargeIntent> {
  try {
    const payload = record(body, "body");

    return {
      ok: true,
      data: {
        idempotency_key: text(payload.idempotency_key, "idempotency_key"),
        customer_id: text(payload.customer_id, "customer_id"),
        amount: money(payload.amount, "amount"),
        currency: option(payload.currency, CURRENCIES, "currency"),
        method: getPaymentMethod(payload.method),
        description: optionalText(payload.description, "description"),
        metadata: stringMap(payload.metadata, "metadata"),
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }

    return { ok: false, error: "malformed charge payload" };
  }
}
