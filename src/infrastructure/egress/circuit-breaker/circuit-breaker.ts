type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  public state: CircuitState = "CLOSED";
  private failure_count: number = 0;

  private failure_threshold: number;
  private timeout_period: number;
  private recovery_timeout: number;
  private next_attempt_time: number = 0;

  private constructor(
    failureThreshold: number = 5,
    timeoutPeriod: number = 10000,
    recoveryTimeout: number = 15000,
  ) {
    this.failure_threshold = failureThreshold;
    this.timeout_period = timeoutPeriod;
    this.recovery_timeout = recoveryTimeout;
  }

  static init() {
    if (globalThis.circuitBreaker)
      throw new Error("[circuit breaker]: already initialized");

    globalThis.circuitBreaker = new CircuitBreaker();
    const { state, failure_threshold, timeout_period, recovery_timeout } =
      globalThis.circuitBreaker;
    console.info(
      `[circuit breaker]: active, initial state: ${state} (threshold: ${failure_threshold}, timeout: ${timeout_period}ms, recovery: ${recovery_timeout}ms)`,
    );
  }

  static async execute<T = unknown>(apiCall: () => Promise<T>): Promise<T> {
    const instance = globalThis.circuitBreaker;
    if (!instance) {
      throw new Error(
        "[circuit breaker]: not initialized. Call CircuitBreaker.init() first.",
      );
    }

    if (instance.state !== "CLOSED") {
      // Only the request that flips OPEN -> HALF_OPEN is let through. Whoever
      // finds the circuit already half open is arriving behind a probe that is
      // still in flight, and gets turned away: a service that is coming back
      // deserves one caller asking how it feels, not the whole queue at once
      const isProbe =
        instance.state === "OPEN" && Date.now() >= instance.next_attempt_time;

      if (!isProbe) {
        if (instance.state === "HALF_OPEN") {
          console.warn(
            "[circuit breaker]: fast-fail. A probe is already in flight",
          );
        } else {
          const remaining = instance.next_attempt_time - Date.now();
          console.warn(
            `[circuit breaker]: fast-fail. Circuit OPEN, retry in ${remaining}ms`,
          );
        }

        throw new Error(
          "[circuit breaker]: fast-fail triggered. Circuit is not accepting traffic.",
        );
      }

      instance.state = "HALF_OPEN";
      console.info(
        "[circuit breaker]: switching to HALF_OPEN. Testing service...",
      );
    }

    const started_at = Date.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("[circuit breaker]: Request Timeout")),
          instance.timeout_period,
        ),
      );

      const response = await Promise.race([apiCall(), timeoutPromise]);

      console.info(
        `[circuit breaker]: call succeeded in ${Date.now() - started_at}ms (state: ${instance.state})`,
      );
      instance.onSuccess();

      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[circuit breaker]: call failed after ${Date.now() - started_at}ms (state: ${instance.state}) -> ${reason}`,
      );
      instance.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.failure_count > 0) {
      console.info(
        `[circuit breaker]: failure count reset (was ${this.failure_count}/${this.failure_threshold})`,
      );
    }

    this.failure_count = 0;

    if (this.state === "HALF_OPEN") {
      console.info(
        "[circuit breaker]: test successful. HALF_OPEN -> CLOSED. Circuit restored.",
      );
    }

    this.state = "CLOSED";
  }

  private onFailure() {
    this.failure_count++;
    console.warn(
      `[circuit breaker]: Request failed. Failure count: ${this.failure_count}/${this.failure_threshold}`,
    );

    // A failure landing on an already open circuit is stale news: the call was
    // in flight when the circuit tripped. Acting on it would push the next
    // attempt further away every time, and under load the cooldown never ends
    if (this.state === "OPEN") return;

    if (
      this.state === "HALF_OPEN" ||
      this.failure_count >= this.failure_threshold
    ) {
      const previous_state = this.state;
      this.state = "OPEN";
      this.next_attempt_time = Date.now() + this.recovery_timeout;
      console.error(
        `[circuit breaker]: ${previous_state} -> OPEN. Isolating traffic for ${this.recovery_timeout}ms (next attempt at ${new Date(this.next_attempt_time).toISOString()})`,
      );
    }
  }
}
