/**
 * Driving licence NUMBER gate at pickup (X2). The DL / KYC picture is optional;
 * what staff must have before handing over a vehicle is the customer's DL number.
 *
 * Shared by both pickup paths (legacy POST /employee/pickup/:bookingId and the
 * pickup payment session initiate). The request may carry `drivingLicenceNumber`
 * (raw input: spaces, '-', '/' and lowercase are fine). It is validated and
 * normalised with the shared @repo/schemas validator, saved to
 * Customer.drivingLicenceNumber (staff may correct a stored number after checking
 * the card), logged as staff activity, and the profile completeness recomputed.
 *  - sent and valid            → used (saved when it differs from the stored one)
 *  - sent but invalid          → 400 INVALID_DL_NUMBER
 *  - blank / null / omitted    → the stored number; none stored → 422 DL_NUMBER_REQUIRED
 */
import type { Request } from "express";
import { prisma } from "@repo/database/client";
import { DL_INVALID_MESSAGE, drivingLicenceNumberSchema } from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";
import { getMissingProfileFields, profileFieldsOf } from "../../utils/customer/identity.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../staffActivity/staffActivity.service.js";

export const DL_NUMBER_REQUIRED_MESSAGE =
  "Enter the customer's driving licence number before handing over the vehicle.";

export type PickupDlNumberErrorCode = "DL_NUMBER_REQUIRED" | "INVALID_DL_NUMBER" | "CUSTOMER_NOT_FOUND";

export class PickupDlNumberError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: PickupDlNumberErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PickupDlNumberError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

type Db = Pick<typeof prisma, "customer">;

/**
 * Validates + normalises the DL number a pickup request carries. Blank, null or
 * omitted ⇒ null (not sent). Throws PickupDlNumberError 400 INVALID_DL_NUMBER.
 */
export function parsePickupDlNumber(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const parsed = drivingLicenceNumberSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PickupDlNumberError(StatusCode.BAD_REQUEST, "INVALID_DL_NUMBER", DL_INVALID_MESSAGE);
  }
  return parsed.data;
}

export interface PickupDlNumber {
  customerId: number;
  /** The customer's User.publicId (what the staff customer endpoints use). */
  customerUserPublicId: string;
  /** The normalised number the handover goes ahead with. */
  drivingLicenceNumber: string;
  /** The number stored before this pickup (null = none on file). */
  previous: string | null;
  /** true ⇒ the sent number differs from the stored one and must be saved. */
  changed: boolean;
  /** Profile completeness once the number is saved. */
  isProfileCompleted: boolean;
}

/**
 * The DL number this pickup goes ahead with: `sent` (already parsed with
 * parsePickupDlNumber) or the customer's stored number.
 * Throws PickupDlNumberError 422 DL_NUMBER_REQUIRED when there is neither.
 */
export async function resolvePickupDlNumber(
  customerId: number,
  sent: string | null,
  db: Db = prisma,
): Promise<PickupDlNumber> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      publicId: true,
      addressLine1: true,
      city: true,
      state: true,
      zipCode: true,
      country: true,
      drivingLicenceNumber: true,
      aadhaarNumber: true,
      user: { select: { publicId: true, name: true, phone: true } },
    },
  });
  if (!customer) {
    throw new PickupDlNumberError(StatusCode.NOT_FOUND, "CUSTOMER_NOT_FOUND", "Customer not found for this booking.");
  }
  const previous = customer.drivingLicenceNumber?.trim() || null;
  const drivingLicenceNumber = sent ?? previous;
  if (!drivingLicenceNumber) {
    throw new PickupDlNumberError(
      StatusCode.UNPROCESSABLE_ENTITY,
      "DL_NUMBER_REQUIRED",
      DL_NUMBER_REQUIRED_MESSAGE,
    );
  }
  const missing = getMissingProfileFields(
    profileFieldsOf(customer.user, { ...customer, drivingLicenceNumber }),
  );
  return {
    customerId: customer.id,
    customerUserPublicId: customer.user.publicId,
    drivingLicenceNumber,
    previous,
    changed: drivingLicenceNumber !== previous,
    isProfileCompleted: missing.length === 0,
  };
}

/** Saves a changed DL number (and the recomputed completeness). No-op when unchanged. */
export async function savePickupDlNumber(dl: PickupDlNumber, db: Db = prisma): Promise<void> {
  if (!dl.changed) return;
  await db.customer.update({
    where: { id: dl.customerId },
    data: {
      drivingLicenceNumber: dl.drivingLicenceNumber,
      isProfileCompleted: dl.isProfileCompleted,
    },
  });
}

/** Staff-activity entry for a DL number entered / corrected at pickup. No-op when unchanged. */
export async function logPickupDlNumber(
  req: Request,
  dl: PickupDlNumber,
  bookingPublicId: string,
): Promise<void> {
  if (!dl.changed) return;
  await staffActivityService.logFromRequest(req, {
    actionType: StaffActionType.UPDATED,
    entityType: StaffEntityType.CUSTOMER,
    entityRef: dl.customerUserPublicId,
    description: dl.previous
      ? `Driving licence number corrected at pickup for booking ${bookingPublicId}`
      : `Driving licence number added at pickup for booking ${bookingPublicId}`,
    metadata: {
      bookingPublicId,
      drivingLicenceNumber: dl.drivingLicenceNumber,
      previousDrivingLicenceNumber: dl.previous,
      isProfileCompleted: dl.isProfileCompleted,
    },
  });
}
