import {
  ChargeIntent,
  ChargeResult,
  RefundIntent,
  RefundResult,
} from "@/domain/models/payments";

export interface PaymentsGateway {
  charge(payment: ChargeIntent): Promise<ChargeResult>;
  refund(payment: RefundIntent): Promise<RefundResult>;
}
