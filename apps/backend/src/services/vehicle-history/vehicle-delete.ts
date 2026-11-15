/**
 * Deleting a vehicle from the branch manager portal (Nov 14 2026). Pure rules,
 * no database.
 *
 * A vehicle is never hard-deleted (its rentals, photos, damage and money keep
 * pointing at it): it is soft-deleted (deletedAt + INACTIVE). It can't be
 * removed while a booking still needs it — a live hold, a confirmed booking or a
 * car out on rent.
 */

export interface BlockingBooking {
  publicId: string;
  status: "HOLD" | "CONFIRMED" | "PICKED_UP";
  holdExpiresAt: Date | null;
}

/** The bookings that keep the car from being deleted (an expired hold doesn't). */
export function bookingsBlockingDelete<T extends BlockingBooking>(bookings: T[], now: Date): T[] {
  return bookings.filter(
    (b) => b.status !== "HOLD" || !b.holdExpiresAt || b.holdExpiresAt.getTime() > now.getTime(),
  );
}

const shortRef = (publicId: string) => `#${publicId.slice(-8).toUpperCase()}`;

/** The 409 message for a refused delete; null = nothing blocks it. */
export function vehicleDeleteBlockedMessage(regNo: string, blocking: BlockingBooking[]): string | null {
  if (blocking.length === 0) return null;
  const out = blocking.filter((b) => b.status === "PICKED_UP");
  const upcoming = blocking.length - out.length;
  const parts: string[] = [];
  if (out.length > 0) parts.push(`it is out on rent (${out.map((b) => shortRef(b.publicId)).join(", ")})`);
  if (upcoming > 0) {
    const refs = blocking.filter((b) => b.status !== "PICKED_UP").slice(0, 3).map((b) => shortRef(b.publicId));
    parts.push(
      `it has ${upcoming} upcoming booking${upcoming === 1 ? "" : "s"} (${refs.join(", ")}${upcoming > 3 ? ", …" : ""})`,
    );
  }
  return `Can't delete ${regNo}: ${parts.join(" and ")}. Complete, cancel or swap ${
    blocking.length === 1 ? "that booking" : "those bookings"
  } to another vehicle first.`;
}
