import { RefundIntent } from "@/domain/models/payments";
import { ParsedPayload } from "./charge-payload";
import {
  ValidationError,
  optionalMoney,
  optionalText,
  record,
  stringMap,
  text,
} from "./lib";

// Same rule as the charge: an untrusted body becomes a RefundIntent, or it does
// not become anything. An absent amount is a full refund, not a bad request
export function getRefundPayload(body: unknown): ParsedPayload<RefundIntent> {
  try {
    const payload = record(body, "body");

    return {
      ok: true,
      data: {
        idempotency_key: text(payload.idempotency_key, "idempotency_key"),
        payment_id: text(payload.payment_id, "payment_id"),
        amount: optionalMoney(payload.amount, "amount"),
        reason: optionalText(payload.reason, "reason"),
        metadata: stringMap(payload.metadata, "metadata"),
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }

    return { ok: false, error: "malformed refund payload" };
  }
}
