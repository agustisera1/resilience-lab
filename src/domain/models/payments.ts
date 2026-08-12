export type Currency = "USD" | "EUR" | "ARS";

export type CardBrand = "visa" | "mastercard" | "amex";

export type PaymentMethod = {
  type: "card";
  brand: CardBrand;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder: string;
};

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "charged"
  | "failed"
  | "refunded";

export type PaymentFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

// The intent: only what the caller owns. Everything the processor decides
// (its id, the fee, the status, the timestamps) is absent on purpose.
export type ChargeIntent = {
  idempotency_key: string;
  customer_id: string;
  amount: string;
  currency: Currency;
  method: PaymentMethod;
  description: string | null;
  metadata?: Record<string, string>;
};

export type Payment = {
  id: string;
  idempotency_key: string;
  // Assigned by the processor, null while the charge is still in flight
  processor_payment_id: string | null;
  customer_id: string;
  description: string | null;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  failure: PaymentFailure | null;
  amount: string;
  fee: string;
  // net = amount - fee
  net: string;
  created_at: string;
  metadata?: Record<string, string>;
};

// What the gateway reports back from a charge attempt. A decline is a result,
// not an error: the call went through, the processor said no.
// What the processor does not decide (our own id, the idempotency key, the
// method) is absent: the caller already has it.
export type ChargeResult =
  | {
      status: "charged";
      processor_payment_id: string;
      currency: Currency;
      amount: string;
      fee: string;
      // net = amount - fee
      net: string;
      created_at: string;
    }
  | {
      status: "failed";
      // El procesador puede haber registrado el intento igual, o no
      processor_payment_id: string | null;
      failure: PaymentFailure;
    };

// Mirrors ChargeIntent: only what the caller owns. The currency and the method
// are not here, the payment being refunded already fixed them.
export type RefundIntent = {
  idempotency_key: string;
  payment_id: string;
  // null means the whole refundable balance
  amount: string | null;
  reason: string | null;
  metadata?: Record<string, string>;
};

// Same shape of contract as ChargeResult: a rejected refund is a result, not
// an error. amount is what this refund moved; what is left refundable is the
// payment's business, the processor does not report it here.
export type RefundResult =
  | {
      status: "refunded";
      processor_refund_id: string;
      processor_payment_id: string;
      currency: Currency;
      amount: string;
      created_at: string;
    }
  | {
      status: "failed";
      processor_refund_id: string | null;
      failure: PaymentFailure;
    };

export type Refundable = Payment & {
  refunded: string;
  approved: boolean;
  deposit: boolean;
};
