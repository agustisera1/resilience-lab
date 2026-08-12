import { ChargeIntent, ChargeResult, Payment } from "../domain/models/payments";

export interface PaymentsGateway {
  charge(payment: ChargeIntent): Promise<ChargeResult>;
  refund(payment: Payment): void;
}
