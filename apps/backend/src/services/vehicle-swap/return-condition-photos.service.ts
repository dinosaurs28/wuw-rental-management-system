/**
 * The handover photos of the car being returned (client item 2), for the drop
 * screens: the pickup photos, or — after a mid-rental swap — the photos of the
 * replacement taken at the (last) swap, plus the earlier cars' sets.
 */
import { prisma, BookingPhotoType } from "@repo/database/client";
import { resolveFileUrl } from "../../utils/file-url.js";
import { pickedUpAtMarker } from "../charges/km-allowance.service.js";
import { selectReturnConditionPhotos, type ConditionPhotoSet, type VehicleRef } from "./swap-photos.js";

export interface ConditionPhoto {
  publicId: string;
  captureLabel: string | null;
  url: string;
  mime: string;
}

export interface ConditionPhotoSetView extends Omit<ConditionPhotoSet<ConditionPhoto>, "takenAt" | "photos"> {
  takenAt: string | null;
  photos: ConditionPhoto[];
}

export interface ReturnConditionPhotosView {
  /** PRE_DELIVERY photos, as GetPickupCaptures always returned them (older app builds) */
  photos: ConditionPhoto[];
  /** The car being returned: its handover photos (the last mid-rental swap's, else the pickup's) */
  currentVehicleCaptures: ConditionPhotoSetView;
  /** Cars swapped out during the rental, newest first, the original pickup last (sets with photos) */
  earlierCaptures: ConditionPhotoSetView[];
  /** The booking had a mid-rental swap */
  swapped: boolean;
  /** No photo was taken of the car being returned at its swap */
  photosMissing: boolean;
}

const vehicleRefSelect = { regNo: true, make: true, model: true } as const;
const photoSelect = {
  publicId: true,
  captureLabel: true,
  createdAt: true,
  file: { select: { key: true, url: true, mime: true } },
} as const;

export async function getReturnConditionPhotos(bookingId: number): Promise<ReturnConditionPhotosView> {
  const [pickupRows, swaps, item, pickedUpAt] = await Promise.all([
    prisma.bookingPhoto.findMany({
      where: { bookingId, type: BookingPhotoType.PRE_DELIVERY },
      select: photoSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.vehicleSwap.findMany({
      where: { bookingId },
      select: {
        publicId: true,
        swappedAt: true,
        bookingStatusAtSwap: true,
        originalVehicle: { select: vehicleRefSelect },
        newVehicle: { select: vehicleRefSelect },
        photos: { select: photoSelect, orderBy: { id: "asc" } },
      },
      orderBy: { swappedAt: "asc" },
    }),
    prisma.bookingItem.findFirst({
      where: { bookingId },
      orderBy: { id: "asc" },
      select: { vehicle: { select: vehicleRefSelect } },
    }),
    pickedUpAtMarker(bookingId),
  ]);

  type Row = (typeof pickupRows)[number];
  const toPhoto = async (p: Row): Promise<ConditionPhoto & { createdAt: Date }> => ({
    publicId: p.publicId,
    captureLabel: p.captureLabel ?? null,
    url: await resolveFileUrl(p.file),
    mime: p.file.mime,
    createdAt: p.createdAt,
  });

  const pickupPhotos = await Promise.all(pickupRows.map(toPhoto));
  const swapsWithPhotos = await Promise.all(
    swaps.map(async (s) => ({
      publicId: s.publicId,
      swappedAt: s.swappedAt,
      bookingStatusAtSwap: s.bookingStatusAtSwap,
      originalVehicle: s.originalVehicle as VehicleRef,
      newVehicle: s.newVehicle as VehicleRef,
      photos: await Promise.all(s.photos.map(toPhoto)),
    })),
  );

  const selected = selectReturnConditionPhotos({
    pickupPhotos,
    swaps: swapsWithPhotos,
    currentVehicle: item?.vehicle ?? null,
    pickedUpAt,
  });

  const strip = ({ createdAt: _createdAt, ...photo }: ConditionPhoto & { createdAt: Date }): ConditionPhoto => photo;
  const view = (set: ConditionPhotoSet<ConditionPhoto & { createdAt: Date }>): ConditionPhotoSetView => ({
    ...set,
    takenAt: set.takenAt ? set.takenAt.toISOString() : null,
    photos: set.photos.map(strip),
  });

  return {
    photos: pickupPhotos.map(strip),
    currentVehicleCaptures: view(selected.current),
    earlierCaptures: selected.earlier.map(view),
    swapped: selected.swapped,
    photosMissing: selected.photosMissing,
  };
}
