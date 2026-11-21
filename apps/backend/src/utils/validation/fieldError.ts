/**
 * A 400 body for a request that failed zod validation, naming the field.
 *
 * Nov 21 2026 (client report): the pickup's "Save & back to Payment" showed only
 * "Validation failed" — the apps display `message`, so it must say what is wrong
 * and where. `errors` (zod's format()) stays for older clients that read it.
 */
export interface FieldValidationIssue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

export interface FieldValidationBody {
  success: false;
  code: "VALIDATION_FAILED";
  /** The request field (first path segment), null for the body itself. */
  field: string | null;
  /** The full path, e.g. "photos.3.label". */
  path: string | null;
  message: string;
  errors?: unknown;
}

// zod's own wording ("Too big: expected …", "Invalid input: …") reads badly on its
// own: those get the field's name in front. Messages written for a field stay as they are.
const ZOD_DEFAULT = /^(Invalid|Too (big|small)|Expected|Required|Unrecognized)/;

export function fieldValidationError(
  error: { issues: ReadonlyArray<FieldValidationIssue>; format?: () => unknown },
  labels: Record<string, string> = {},
): FieldValidationBody {
  const issue = error.issues[0];
  const path = issue ? issue.path.map((p) => String(p)) : [];
  const field = path[0] ?? null;
  let message = issue?.message?.trim() || "Some of the details sent couldn't be read.";
  if (field && ZOD_DEFAULT.test(message)) {
    const label = labels[field] ?? field;
    const index = path.length > 1 && /^\d+$/.test(path[1]!) ? ` (item ${Number(path[1]) + 1})` : "";
    message = `${label}${index}: ${message}`;
  }
  return {
    success: false,
    code: "VALIDATION_FAILED",
    field,
    path: path.length ? path.join(".") : null,
    message,
    ...(error.format ? { errors: error.format() } : {}),
  };
}
