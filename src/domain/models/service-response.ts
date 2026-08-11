export type ServiceResponse<D = unknown> = Promise<
  | {
      data: D;
      ok: true;
      status: number;
    }
  | { ok: false; error: string; status: number }
>;
