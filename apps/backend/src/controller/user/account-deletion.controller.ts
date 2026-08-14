import { Request, Response } from "express";
import { deleteAccountSchema } from "@repo/schemas";
import { prisma, Role, BookingStatus } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { comparehash } from "../../utils/PasswordCrypt/password.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import {
  auditService,
  AuditCategory,
  AuditSeverity,
} from "../../services/audit/audit.service.js";

// Self-service account deletion. Required by Google Play's "Data deletion"
// policy for any app that offers in-app account creation — the Play listing
// links to the public web form at /legal/delete-account, and this endpoint
// backs the in-app path (Profile → Delete account).
//
// This is a SOFT delete plus PII anonymisation, not a row-level purge:
// bookings, invoices, receipts, payments and ledger entries are financial
// records the business is legally required to retain. They keep pointing at
// the (now anonymised) Customer row so the books still reconcile, while every
// piece of personal data that identifies the human is destroyed.
//
// Destroyed immediately: name, email, phone, password hash, OAuth links,
// pending OTPs, address, date of birth, and all KYC documents (government ID
// scans) — both the DB rows and the underlying R2 objects.

// Bookings in these states still have money or a vehicle outstanding, so the
// account cannot be dissolved until they are settled.
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.PICKED_UP,
];

export const deleteAccount = async (req: Request, res: Response) => {
  try {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation Error",
        errors: parsed.error.flatten(),
      });
    }

    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      include: { customerProfile: { select: { id: true } } },
    });

    if (!user || user.role !== Role.CUSTOMER) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Account not found.",
      });
    }

    if (user.deletedAt) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: "This account has already been deleted.",
      });
    }

    // Password-provider accounts must re-authenticate. Google-linked accounts
    // have no passwordHash — for them the typed "DELETE" confirmation plus a
    // valid session is the gate.
    if (user.passwordHash) {
      if (!parsed.data.password) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Please enter your password to confirm deletion.",
        });
      }
      const passwordMatches = await comparehash(
        parsed.data.password,
        user.passwordHash,
      );
      if (!passwordMatches) {
        return res.status(StatusCode.UNAUTHORIZED).json({
          message: "Incorrect password.",
        });
      }
    }

    const customerId = user.customerProfile?.id;

    // Refuse while a rental is live — otherwise a vehicle could be out with no
    // identifiable renter attached to it.
    if (customerId) {
      const activeBookings = await prisma.booking.count({
        where: {
          customerId,
          deletedAt: null,
          status: { in: ACTIVE_BOOKING_STATUSES },
        },
      });

      if (activeBookings > 0) {
        return res.status(StatusCode.CONFLICT).json({
          message:
            "You still have an active or upcoming booking. Please complete or cancel it before deleting your account.",
          activeBookings,
        });
      }
    }

    // Collect KYC file keys before the rows go away so the objects can be
    // purged from R2 afterwards.
    const kycRecords = customerId
      ? await prisma.customerKyc.findMany({
          where: { customerId },
          include: { file: { select: { id: true, key: true } } },
        })
      : [];

    const fileKeys = kycRecords
      .map((k) => k.file?.key)
      .filter((k): k is string => Boolean(k));
    const fileIds = kycRecords
      .map((k) => k.file?.id)
      .filter((id): id is number => typeof id === "number");

    // Tombstone the email so the unique index still holds and the address is
    // freed for re-registration. `.invalid` is reserved by RFC 2606 and can
    // never route to a real inbox.
    const tombstoneEmail = `deleted-${user.publicId}@deleted.invalid`;
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (customerId) {
        await tx.customerKyc.deleteMany({ where: { customerId } });
        if (fileIds.length > 0) {
          await tx.fileObject.deleteMany({ where: { id: { in: fileIds } } });
        }

        await tx.customer.update({
          where: { id: customerId },
          data: {
            alternatePhone: null,
            dob: null,
            addressLine1: "",
            city: "",
            state: "",
            zipCode: "",
            isProfileCompleted: false,
            deletedAt: now,
          },
        });
      }

      // Sever OAuth links and invalidate any outstanding OTP.
      await tx.userProvider.deleteMany({ where: { userId: user.id } });
      await tx.emailVerificationOtp.deleteMany({ where: { userId: user.id } });

      await tx.user.update({
        where: { id: user.id },
        data: {
          name: "Deleted User",
          email: tombstoneEmail,
          phone: "",
          passwordHash: null,
          emailVerifiedAt: null,
          deletedAt: now,
        },
      });
    });

    // R2 objects are removed out-of-band; a failure here must not roll back the
    // deletion, but it is logged loudly because these are government ID scans.
    for (const key of fileKeys) {
      try {
        await fileCleanupQueue.add("delete-account-kyc-file", { key });
      } catch (queueError) {
        console.error(
          `Account deletion: failed to queue R2 cleanup for key ${key}`,
          queueError,
        );
      }
    }

    auditService.log({
      actorId: user.id,
      actorName: "Deleted User",
      actorRole: user.role,
      action: "ACCOUNT_DELETED",
      category: AuditCategory.AUTH,
      severity: AuditSeverity.WARNING,
      description: `Customer account ${user.publicId} self-deleted; ${kycRecords.length} KYC document(s) purged`,
      entity: "User",
      entityId: user.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(StatusCode.OK).json({
      message:
        "Your account has been deleted. Booking and invoice records are retained only as required by law.",
    });
  } catch (e: any) {
    console.error("Internal Error in deleteAccount", e);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while deleting the account",
    });
  }
};
