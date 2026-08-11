export type ServiceResponse<T = unknown> = Promise<
  | {
      data: T;
      ok: true;
      status: number;
    }
  | { ok: false; error: string; status: number }
>;
