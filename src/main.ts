import { StripeGateway } from "./adapters/payments/stripe-gateway";
import { CircuitBreaker } from "./infrastructure/egress/circuit-breaker";
import { createServer } from "./stubs/stripe-server.mock";

const hostname = process.env.hostname;
const port = Number(process.env.port);

async function init() {
  if (!hostname || !port) {
    throw new Error("[init]: missing server config");
  }

  CircuitBreaker.init();
  const stripeServer = createServer(new StripeGateway());
  stripeServer.listen(port, hostname, () => {
    console.info("[stripe]: stub server listening on port:", port);
  });
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
