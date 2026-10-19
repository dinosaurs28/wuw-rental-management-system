/**
 * Extension buffer (Oct 2026). Mirrors packages/schemas/src/extension-buffer.ts
 * by hand (the app doesn't import @repo/schemas); keep the two in step.
 *
 * An extension's new return must be at least EXTENSION_BUFFER_HOURS before
 * the car's next pickup. The server works out "available until" and sends it
 * (availableUntil / limitReason / extensionBufferHours); this is only the
 * fallback label for an older server that sends no extensionBufferHours.
 */
export const EXTENSION_BUFFER_HOURS = 2;
