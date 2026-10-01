import { Request, Response } from "express";
import fs from "fs/promises";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../../types/statusCode.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory, AuditSeverity } from "../../../services/audit/audit.service.js";
import {
  QrPhotoError,
  QR_FILE_SELECT,
  BOOKING_QR_SELECT,
  QR_PHOTO_REPLACEABLE_STATUSES,
  saveCustomerQrPhoto,
  clearCustomerQrPhoto,
  resolveBookingQrPhoto,
  toQrPhotoView,
  frozenError,
} from "../../../services/qr-photo/customer-qr-photo.service.js";

// Customer QR code photo (#4) — a photo of the QR the walk-in customer
// presents (Aadhaar / DigiLocker). Customer-level routes are STAFF-only and
// work for any customer (customers are global, like the walk-in KYC routes).
// Booking-level routes are branch-scoped and mounted for both STAFF and
// MANAGER; the customer is always derived from the booking.

async function discardTempUpload(req: Request): Promise<void> {
  if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
}

async function getActor(req: Request) {
  return prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true },
  });
}

type Actor = NonNullable<Awaited<ReturnType<typeof getActor>>>;

const CUSTOMER_SELECT = {
  publicId: true,
  name: true,
  phone: true,
  deletedAt: true,
  customerProfile: {
    select: {
      id: true,
      publicId: true,
      qrPhotoCapturedAt: true,
      qrPhotoFile: { select: QR_FILE_SELECT },
    },
  },
} as const;

async function findCustomerByUserPublicId(publicId: string) {
  const user = await prisma.user.findUnique({ where: { publicId }, select: CUSTOMER_SELECT });
  if (!user || !user.customerProfile || user.deletedAt) return null;
  return user;
}

function customerEcho(user: { publicId: string; name: string; phone: string }) {
  return { publicId: user.publicId, name: user.name, phone: user.phone };
}

function sendError(res: Response, err: unknown, context: string) {
  if (err instanceof QrPhotoError) {
    return res.status(err.status).json(err.toJSON());
  }
  console.error(`[QrPhoto] ${context}:`, err);
  return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "QR_PHOTO_FAILED",
    message: "Could not save the QR code photo. Please try again.",
  });
}

function logCapture(
  req: Request,
  actor: Actor,
  args: {
    customer: { publicId: string; name: string };
    filePublicId: string;
    replaced: boolean;
    bookingPublicId?: string;
  },
) {
  const verb = args.replaced ? "replaced" : "captured";
  const where = args.bookingPublicId ? ` on booking ${args.bookingPublicId}` : "";
  const metadata = {
    filePublicId: args.filePublicId,
    replaced: args.replaced,
    ...(args.bookingPublicId && { bookingPublicId: args.bookingPublicId }),
  };

  staffActivityService
    .logFromRequest(req, {
      actionType: args.replaced ? StaffActionType.UPDATED : StaffActionType.UPLOADED,
      entityType: StaffEntityType.CUSTOMER,
      entityRef: args.customer.publicId,
      description: `Customer QR code photo ${verb} for ${args.customer.name}${where}`,
      metadata,
    })
    .catch(() => {});

  auditService
    .log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      actorBranchId: actor.branchId ?? undefined,
      action: args.replaced ? "CUSTOMER_QR_PHOTO_REPLACED" : "CUSTOMER_QR_PHOTO_CAPTURED",
      category: AuditCategory.CUSTOMER,
      severity: AuditSeverity.INFO,
      description: `Customer QR code photo ${verb} for ${args.customer.name}${where} by ${actor.name}`,
      entity: "Customer",
      entityId: args.customer.publicId,
      entityLabel: args.customer.name,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata,
    })
    .catch((err) => console.error("[QrPhoto] Audit log error (non-fatal):", err));
}

// ── Customer level (STAFF) ────────────────────────────────────────────────────

// GET /api/employee/customer/:publicId/qr-photo
export const GetCustomerQrPhoto = async (req: Request, res: Response) => {
  try {
    const user = await findCustomerByUserPublicId(req.params.publicId as string);
    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer not found",
      });
    }
    const profile = user.customerProfile!;
    return res.status(StatusCode.OK).json({
      success: true,
      message: profile.qrPhotoFile ? "QR code photo fetched" : "No QR code photo on file",
      data: {
        customer: customerEcho(user),
        qrPhoto: profile.qrPhotoFile
          ? await toQrPhotoView(profile.qrPhotoFile, profile.qrPhotoCapturedAt)
          : null,
      },
    });
  } catch (err) {
    console.error("[QrPhoto] GetCustomerQrPhoto:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "QR_PHOTO_FAILED",
      message: "Could not load the QR code photo. Please try again.",
    });
  }
};

// POST /api/employee/customer/:publicId/qr-photo  (multipart, field "file")
export const UploadCustomerQrPhoto = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "FILE_REQUIRED",
        message: "Please attach the QR code photo in the 'file' field.",
      });
    }

    const [actor, user] = await Promise.all([
      getActor(req),
      findCustomerByUserPublicId(req.params.publicId as string),
    ]);
    if (!actor) {
      await discardTempUpload(req);
      return res.status(StatusCode.UNAUTHORIZED).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not found",
      });
    }
    if (!user) {
      await discardTempUpload(req);
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer not found",
      });
    }
    const profile = user.customerProfile!;

    const saved = await saveCustomerQrPhoto({
      customerId: profile.id,
      customerPublicId: profile.publicId,
      tmpPath: req.file.path,
      actorUserId: actor.id,
    });

    logCapture(req, actor, {
      customer: user,
      filePublicId: saved.file.publicId,
      replaced: saved.replacedCustomerPhoto,
    });

    return res.status(StatusCode.CREATED).json({
      success: true,
      message: saved.replacedCustomerPhoto ? "QR code photo replaced" : "QR code photo saved",
      data: {
        customer: customerEcho(user),
        qrPhoto: await toQrPhotoView(saved.file, saved.capturedAt),
      },
    });
  } catch (err) {
    await discardTempUpload(req);
    return sendError(res, err, "UploadCustomerQrPhoto");
  }
};

// DELETE /api/employee/customer/:publicId/qr-photo
export const DeleteCustomerQrPhoto = async (req: Request, res: Response) => {
  try {
    const [actor, user] = await Promise.all([
      getActor(req),
      findCustomerByUserPublicId(req.params.publicId as string),
    ]);
    if (!actor) {
      return res.status(StatusCode.UNAUTHORIZED).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not found",
      });
    }
    if (!user) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "CUSTOMER_NOT_FOUND",
        message: "Customer not found",
      });
    }

    const removedPublicId = await clearCustomerQrPhoto(user.customerProfile!.id);
    if (removedPublicId === null) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "QR_PHOTO_NOT_FOUND",
        message: "This customer has no QR code photo to remove.",
      });
    }

    const metadata = { filePublicId: removedPublicId };
    staffActivityService
      .logFromRequest(req, {
        actionType: StaffActionType.DELETED,
        entityType: StaffEntityType.CUSTOMER,
        entityRef: user.publicId,
        description: `Customer QR code photo removed for ${user.name}`,
        metadata,
      })
      .catch(() => {});
    auditService
      .log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorBranchId: actor.branchId ?? undefined,
        action: "CUSTOMER_QR_PHOTO_DELETED",
        category: AuditCategory.CUSTOMER,
        severity: AuditSeverity.WARNING,
        description: `Customer QR code photo removed for ${user.name} by ${actor.name}`,
        entity: "Customer",
        entityId: user.publicId,
        entityLabel: user.name,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata,
      })
      .catch((err) => console.error("[QrPhoto] Audit log error (non-fatal):", err));

    return res.status(StatusCode.OK).json({
      success: true,
      message: "QR code photo removed",
      data: { customer: customerEcho(user), qrPhoto: null },
    });
  } catch (err) {
    console.error("[QrPhoto] DeleteCustomerQrPhoto:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "QR_PHOTO_FAILED",
      message: "Could not remove the QR code photo. Please try again.",
    });
  }
};

// ── Booking level (STAFF + MANAGER, branch-scoped) ────────────────────────────

async function findBranchBooking(req: Request) {
  return prisma.booking.findFirst({
    where: { publicId: req.params.bookingId as string, branchId: req.branch_Id },
    select: {
      ...BOOKING_QR_SELECT,
      id: true,
      publicId: true,
      customer: {
        select: {
          ...BOOKING_QR_SELECT.customer.select,
          id: true,
          publicId: true,
          user: { select: { publicId: true, name: true, phone: true } },
        },
      },
    },
  });
}

type BranchBooking = NonNullable<Awaited<ReturnType<typeof findBranchBooking>>>;

async function bookingQrResponse(booking: BranchBooking) {
  const { qrPhoto, source, canReplace } = await resolveBookingQrPhoto(booking);
  return {
    booking: { publicId: booking.publicId, status: booking.status },
    customer: customerEcho(booking.customer.user),
    qrPhoto,
    source,
    canReplace,
  };
}

// GET /api/employee/bookings/:bookingId/qr-photo
// GET /api/branchManager/dashboard/bookings/:bookingId/qr-photo
export const GetBookingQrPhoto = async (req: Request, res: Response) => {
  try {
    const booking = await findBranchBooking(req);
    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "BOOKING_NOT_FOUND",
        message: "Booking not found",
      });
    }
    return res.status(StatusCode.OK).json({
      success: true,
      message: "QR code photo fetched",
      data: await bookingQrResponse(booking),
    });
  } catch (err) {
    console.error("[QrPhoto] GetBookingQrPhoto:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "QR_PHOTO_FAILED",
      message: "Could not load the QR code photo. Please try again.",
    });
  }
};

// POST /api/employee/bookings/:bookingId/qr-photo                 (multipart, field "file")
// POST /api/branchManager/dashboard/bookings/:bookingId/qr-photo  (multipart, field "file")
// Replaces the booking's snapshot (HOLD/CONFIRMED only) and makes the same
// photo the customer's current one.
export const UploadBookingQrPhoto = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "FILE_REQUIRED",
        message: "Please attach the QR code photo in the 'file' field.",
      });
    }

    const [actor, booking] = await Promise.all([getActor(req), findBranchBooking(req)]);
    if (!actor) {
      await discardTempUpload(req);
      return res.status(StatusCode.UNAUTHORIZED).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not found",
      });
    }
    if (!booking) {
      await discardTempUpload(req);
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "BOOKING_NOT_FOUND",
        message: "Booking not found",
      });
    }
    // Fail fast before decoding/uploading; re-checked atomically on write.
    if (!QR_PHOTO_REPLACEABLE_STATUSES.includes(booking.status)) {
      await discardTempUpload(req);
      const err = frozenError(booking.status);
      return res.status(err.status).json(err.toJSON());
    }

    const saved = await saveCustomerQrPhoto({
      customerId: booking.customer.id,
      customerPublicId: booking.customer.publicId,
      tmpPath: req.file.path,
      actorUserId: actor.id,
      bookingId: booking.id,
    });

    logCapture(req, actor, {
      customer: booking.customer.user,
      filePublicId: saved.file.publicId,
      replaced: saved.replacedBookingPhoto,
      bookingPublicId: booking.publicId,
    });

    const refreshed = await findBranchBooking(req);
    return res.status(StatusCode.CREATED).json({
      success: true,
      message: saved.replacedBookingPhoto ? "QR code photo replaced" : "QR code photo saved",
      data: refreshed
        ? await bookingQrResponse(refreshed)
        : {
            booking: { publicId: booking.publicId, status: booking.status },
            customer: customerEcho(booking.customer.user),
            qrPhoto: await toQrPhotoView(saved.file, saved.capturedAt),
            source: "BOOKING" as const,
            canReplace: true,
          },
    });
  } catch (err) {
    await discardTempUpload(req);
    return sendError(res, err, "UploadBookingQrPhoto");
  }
};
