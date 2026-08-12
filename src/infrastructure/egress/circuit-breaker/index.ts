type ServiceState = {
  payments: "OPEN" | "HALF-OPEN" | "CLOSED";
};

export class CircuitBreaker {
  state: ServiceState = { payments: "CLOSED" };
  private failure_threshold = 5; // Max attempts before open
  private timeout_period = 30; // How long the circuit stays open (secs)
  private recovery_timeout = 5; // Time to wait for service calls (secs)

  private constructor() {}

  static init() {
    if (global.circuitBreaker)
      throw new Error("[circuit breaker]: already initialized");
    global.circuitBreaker = new CircuitBreaker();
    console.info(
      "[circuit breaker]: active, initial state:",
      global.circuitBreaker.state,
    );
    return global.circuitBreaker;
  }

  static get(): CircuitBreaker {
    if (!global.circuitBreaker)
      throw new Error("[circuit breaker]: not initialized");
    return global.circuitBreaker;
  }

  static checkServiceAvailability(name: string) {
    const cb = this.get();
    const circuit = cb.state[name as keyof typeof cb.state];
    if (!circuit) throw new Error("[circuit breaker]: invalid service");

    // Everything but OPEN lets the call through, HALF-OPEN included
    const allowed = circuit !== "OPEN";
    console.info(
      `[circuit breaker]: checked ${name}, state ${circuit}, call ${allowed ? "allowed" : "blocked"}`,
    );

    return allowed;
  }
}
