import { ServiceResponse } from "../../domain/models/response.model.js";
import { StripeAPI } from "../../stubs/stripe-api.mock.js";
import type { Payment } from "../../stubs/stripe-api.mock.js";

export async function chargePayment(
  payment: Payment,
): Promise<ServiceResponse> {
  const response = await StripeAPI.charge(payment);

  if (response.ok) {
    return {
      ok: true,
      data: await response.json(),
      status: response.status,
    };
  } else {
    return {
      ok: false,
      error: response.statusText,
      status: response.status,
    };
  }
}

export async function refundPayment(payment: Payment) {
  const response = await StripeAPI.refund(payment);

  if (response.ok) {
    return {
      ok: true,
      data: await response.json(),
      status: response.status,
    };
  } else {
    return {
      ok: false,
      error: response.statusText,
      status: response.status,
    };
  }
}
