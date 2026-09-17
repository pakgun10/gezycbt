export type IdempotencyReservation =
  | { readonly status: "NEW" }
  | { readonly status: "REPLAY"; readonly response: unknown }
  | { readonly status: "CONFLICT" };

export interface IdempotencyPort {
  reserve(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyReservation>;
  complete(scope: string, key: string, response: unknown): Promise<void>;
}

export async function executeIdempotent<T>(
  port: IdempotencyPort,
  scope: string,
  key: string,
  requestHash: string,
  operation: () => Promise<T>,
): Promise<T> {
  const reservation = await port.reserve(scope, key, requestHash);
  if (reservation.status === "REPLAY") return reservation.response as T;
  if (reservation.status === "CONFLICT")
    throw new Error("Idempotency key conflicts with another payload");
  const response = await operation();
  await port.complete(scope, key, response);
  return response;
}
