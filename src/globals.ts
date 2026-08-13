import { CircuitBreaker } from "./infrastructure/egress/circuit-breaker/circuit-breaker";
import { StripeMockServer } from "./stubs/stripe-api.mock";

declare global {
  //** WARNING: Both must be a distributed singleton. It cannot live on every process.
  // Refactor the initialization to move this logic outside of the process for both */
  var stripeServer: StripeMockServer;
  var circuitBreaker: CircuitBreaker;
}
