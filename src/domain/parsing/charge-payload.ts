import { ChargeIntent, PaymentMethod } from "@/domain/models/payments";
import {
  CARD_BRANDS,
  CURRENCIES,
  LAST4,
  METHOD_TYPES,
  ValidationError,
  integer,
  money,
  option,
  optionalText,
  pattern,
  record,
  stringMap,
  text,
} from "./lib";

export type ParsedPayload<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

// The ingress side: an untrusted body becomes a ChargeIntent, or it does not
// become anything. Which protocol it arrived by is not this function's problem
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
