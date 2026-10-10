import { prisma } from "@repo/database/client";
import { fileCleanupQueue } from "../lib/queue.client.js";
import { isPrivateFile } from "../utils/file-url.js";

export type DeleteUploadedPhotoResult = "DELETED" | "NOT_FOUND" | "IN_USE";

// Keys written by the pickup, return and damage photo uploads (public bucket).
// Mirrors DRAFT_PHOTO_KEY_PREFIXES in services/booking/operation-draft.service.ts.
const BOOKING_PHOTO_KEY_PREFIXES = ["pickup/", "returns/", "damage/"];

/**
 * Deletes a pickup / return / damage photo that was uploaded but never saved
 * with a booking (staff removing a shot before submitting).
 *
 * A photo already attached to a booking (a BookingPhoto row — e.g. saved when
 * the pickup payment session was started) or kept in a paused pickup / drop
 * (OperationDraft, which holds fileIds in its JSON with no foreign key) is
 * kept and reported IN_USE. The row is always deleted before the R2 object is
 * queued for removal: queuing the R2 delete first, as these endpoints used to,
 * erased the image of an attached photo whose row the database then refused
 * to delete, leaving the booking pointing at an object that no longer exists
 * ("Failed to load photo").
 *
 * FileObject records no branch or uploader, so this can't be branch-scoped.
 */
export async function deleteUploadedPhoto(publicId: string): Promise<DeleteUploadedPhotoResult> {
  const file = await prisma.fileObject.findUnique({
    where: { publicId },
    select: { id: true, key: true, url: true, _count: { select: { bookingPhotos: true } } },
  });
  // Only photo uploads, never another public file (vehicle image, promo
  // banner, pre-June-2026 KYC) or a private one (KYC, payment proof, invoice).
  if (
    !file ||
    isPrivateFile(file) ||
    !BOOKING_PHOTO_KEY_PREFIXES.some((prefix) => file.key.startsWith(prefix))
  ) {
    return "NOT_FOUND";
  }
  if (file._count.bookingPhotos > 0) return "IN_USE";

  // OperationDraft.data = { schemaVersion, data, photos: [{ fileId, label }] }
  const inDraft = await prisma.operationDraft.count({
    where: { data: { path: ["photos"], array_contains: [{ fileId: publicId }] } },
  });
  if (inDraft > 0) return "IN_USE";

  try {
    await prisma.fileObject.delete({ where: { id: file.id } });
  } catch (error: any) {
    // Referenced from somewhere else (foreign key): keep the file and its image.
    if (error?.code === "P2003") return "IN_USE";
    // Deleted by a concurrent request in the meantime.
    if (error?.code === "P2025") return "NOT_FOUND";
    throw error;
  }

  // The row is gone, so the photo is deleted for the app; a failed queue add
  // only leaves an unreferenced object behind in R2.
  await fileCleanupQueue.add("cleanup", { key: file.key }).catch((error) => {
    console.warn(`[booking-photo] Could not queue R2 cleanup for ${file.key}:`, error);
  });
  return "DELETED";
}
