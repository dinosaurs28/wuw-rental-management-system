// What an API error says, in words staff can act on (Nov 21 2026 client report:
// the pickup's "Save & back to Payment" showed only "Validation failed" or the
// screen's generic "Couldn't save the changes. Please try again.").
//
//  - the server's own message, when it gave one — but a bare "Validation failed"
//    (servers before Nov 21 2026) is replaced by the first field error it listed;
//  - no answer at all (offline, timed out): say so — nothing reached the server;
//  - an answer without a message (a gateway page, an old endpoint): the screen's
//    fallback with the status, so it can be reported.
//
// Pure (no React Native) so it is unit-tested:
//   cd mobile && ../apps/backend/node_modules/.bin/tsx --test lib/apiError.test.ts

const FIELD_LABELS: Record<string, string> = {
  odo: 'Odometer',
  fuelLevel: 'Fuel level',
  pickupFuelLevel: 'Fuel level',
  dropFuelLevel: 'Fuel level',
  pickupFastagBalance: 'FASTag balance',
  dropFastagBalance: 'FASTag balance',
  photos: 'Photos',
  pickupImageIds: 'Photos',
  captureImages: 'Photos',
  photoOrder: 'Photos',
  dlStatus: 'Licence',
  pickupNote: 'Pickup note',
  dropNote: 'Drop note',
  amount: 'Amount',
  reason: 'Reason',
  discountCode: 'Coupon code',
};

const GENERIC = /^(validation failed|invalid (input|request|inputs?))\.?$/i;

/** First field error in a zod `format()` tree: { field, path, message }. */
export function firstFormattedError(errors: unknown): { field: string | null; path: string; message: string } | null {
  const walk = (node: unknown, path: string[]): { field: string | null; path: string; message: string } | null => {
    if (!node || typeof node !== 'object') return null;
    const own = (node as { _errors?: unknown })._errors;
    if (Array.isArray(own) && typeof own[0] === 'string' && own[0]) {
      return { field: path[0] ?? null, path: path.join('.'), message: own[0] };
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === '_errors') continue;
      const hit = walk(child, [...path, key]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(errors, []);
}

function fieldMessage(field: string | null, path: string, message: string): string {
  if (!field) return message;
  const label = FIELD_LABELS[field] ?? field;
  const item = /^[^.]+\.(\d+)/.exec(path);
  return `${label}${item ? ` (item ${Number(item[1]) + 1})` : ''}: ${message}`;
}

export function describeApiError(err: any, fallback: string): string {
  const response = err?.response;
  if (!response) {
    const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message ?? ''));
    if (err && (err.isAxiosError || err.request || timedOut)) {
      return timedOut
        ? `${fallback} The server took too long to answer — check the connection and try again.`
        : `${fallback} The server couldn't be reached — check the connection and try again.`;
    }
    return fallback;
  }
  const data = response.data;
  const message = typeof data?.message === 'string' ? data.message.trim() : '';
  if (message && !GENERIC.test(message)) return message;
  const first = firstFormattedError(data?.errors);
  if (first) return fieldMessage(first.field, first.path, first.message);
  if (message) return message;
  const status = typeof response.status === 'number' ? response.status : null;
  return status ? `${fallback} (server error ${status})` : fallback;
}
