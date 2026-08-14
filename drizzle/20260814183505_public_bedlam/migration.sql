CREATE TYPE "currency" AS ENUM('USD', 'EUR', 'ARS');--> statement-breakpoint
CREATE TYPE "outbox_status" AS ENUM('pending', 'dispatched');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('pending', 'charged', 'failed');--> statement-breakpoint
CREATE TYPE "refund_status" AS ENUM('pending', 'refunded', 'failed');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"refund_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending'::"outbox_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"idempotency_key" text NOT NULL,
	"processor_payment_id" text,
	"customer_id" text NOT NULL,
	"currency" "currency" NOT NULL,
	"method" jsonb NOT NULL,
	"status" "payment_status" DEFAULT 'pending'::"payment_status" NOT NULL,
	"failure" jsonb,
	"amount" numeric(18,2) NOT NULL,
	"fee" numeric(18,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"idempotency_key" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"processor_refund_id" text,
	"amount" numeric(18,2) NOT NULL,
	"status" "refund_status" DEFAULT 'pending'::"refund_status" NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_refund_id_idx" ON "outbox" ("refund_id");--> statement-breakpoint
CREATE INDEX "outbox_poll_idx" ON "outbox" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_idx" ON "payments" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_customer_id_idx" ON "payments" ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key_idx" ON "refunds" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" ("payment_id");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_refund_id_refunds_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id");