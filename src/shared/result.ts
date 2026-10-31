export type AppError = {
  code: string;
  message: string;
  retryable: boolean;
  /** Safe to show to the user. */
  userMessage: string;
};

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E = AppError>(error: E): Result<never, E> => ({ ok: false, error });

export function appError(
  code: string,
  userMessage: string,
  opts: { retryable?: boolean; message?: string } = {},
): AppError {
  return {
    code,
    userMessage,
    retryable: opts.retryable ?? false,
    message: opts.message ?? userMessage,
  };
}

/** Wraps an async call, converting any thrown value to a Result. */
export async function attempt<T>(
  fn: () => Promise<T>,
  toError: (e: unknown) => AppError,
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toError(e));
  }
}
