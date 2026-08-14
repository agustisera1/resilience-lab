import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Currency,
  PaymentFailure,
  PaymentMethod,
  PaymentStatus,
  RefundJob,
} from "@/domain/models/payments";

// The `satisfies` ties each enum to the domain one way only: a value that stops
// existing in the model stops compiling here. Adding one to the model breaks
// nothing, because these lists are subsets on purpose ('authorized' is not
// reachable in any flow of this repo).
const CURRENCIES = ["USD", "EUR", "ARS"] as const satisfies readonly Currency[];

const PAYMENT_STATUSES = [
  "pending",
  "charged",
  "failed",
] as const satisfies readonly PaymentStatus[];

const REFUND_STATUSES = [
  "pending",
  "refunded",
  "failed",
] as const satisfies readonly PaymentStatus[];

export const currency = pgEnum("currency", CURRENCIES);
export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);
export const refundStatus = pgEnum("refund_status", REFUND_STATUSES);

// Money is numeric, never float: 10.10 has no binary representation. The models
// carry it as string and drizzle hands numeric back as string, so the domain
// never sees a JS number.
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

// Sync flow. The row is written before the gateway call and closed with the
// result, both inside the same request:
//
//   insert(pending) -> gateway -> API -> update(charged|failed) -> response
//
// Writing it first is what makes the charge recoverable: if the process dies
// mid-charge the row stays 'pending' instead of the charge leaving no trace.
// The TS keys are snake_case on purpose, matching the column names and the
// domain models. A row read comes out already shaped like the model, so there
// is no mapper between the driver and the domain.
export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    // The caller's key, and the double-charge guard: of two identical requests
    // racing, the second breaks here before reaching the processor.
    idempotency_key: text("idempotency_key").notNull(),
    // Null while pending, and on a failure the processor never registered.
    processor_payment_id: text("processor_payment_id"),
    customer_id: text("customer_id").notNull(),
    currency: currency().notNull(),
    // The card is one value, not four columns.
    method: jsonb().$type<PaymentMethod>().notNull(),
    status: paymentStatus().notNull().default("pending"),
    // Only when status = 'failed'.
    failure: jsonb().$type<PaymentFailure>(),
    amount: money("amount").notNull(),
    // Null until the processor answers: the fee is its decision, not ours.
    // net is not a column: it is amount - fee, and storing it is storing a
    // subtraction that can drift.
    fee: money("fee"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_idempotency_key_idx").on(table.idempotency_key),
    index("payments_customer_id_idx").on(table.customer_id),
  ],
);

// Async flow. The server writes this row and the outbox entry in one
// transaction; the worker closes it later.
//
// This is the record of what happened, not the message that gets sent. What
// the processor needs to hear (its own payment id, the currency) travels in
// the outbox payload, built at insert while the request still has the payment
// in hand -- so it is not copied back here.
export const refundsTable = pgTable(
  "refunds",
  {
    id: uuid().primaryKey().defaultRandom(),
    idempotency_key: text("idempotency_key").notNull(),
    payment_id: uuid("payment_id")
      .notNull()
      .references(() => paymentsTable.id),
    // Null until the worker gets an answer.
    processor_refund_id: text("processor_refund_id"),
    // Resolved at insert time: a null amount in the intent means "everything
    // refundable", and what that was is decided once, not re-read later.
    amount: money("amount").notNull(),
    status: refundStatus().notNull().default("pending"),
    failure: jsonb().$type<PaymentFailure>(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("refunds_idempotency_key_idx").on(table.idempotency_key),
    // The refundable balance is derived, not stored on the payment:
    // amount - sum(refunds where payment_id = ? and status = 'refunded').
    index("refunds_payment_id_idx").on(table.payment_id),
  ],
);

export const outboxStatus = pgEnum("outbox_status", ["pending", "dispatched"]);

// The whole point of the table: the refund and the intent to enqueue it are
// written in one transaction, so neither can exist without the other. Nothing
// touches the queue during the request -- Postgres and Redis cannot commit
// together, so the queue is left out of it entirely.
//
// The entry carries the message, not a pointer to it, which is what lets the
// relay poll one table and enqueue without a join. The FK is still here, so
// today this is an outbox of refunds; a second kind of job means dropping it
// and adding a `type`, and the payload column stays as it is.
export const outboxTable = pgTable(
  "outbox",
  {
    id: uuid().primaryKey().defaultRandom(),
    refund_id: uuid("refund_id")
      .notNull()
      .references(() => refundsTable.id),
    payload: jsonb().$type<RefundJob>().notNull(),
    status: outboxStatus().notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One entry per refund: the insert is the deduplication, a refund cannot be
    // enqueued twice.
    uniqueIndex("outbox_refund_id_idx").on(table.refund_id),
    // The relay's only query: pending, oldest first.
    index("outbox_poll_idx").on(table.status, table.created_at),
  ],
);
