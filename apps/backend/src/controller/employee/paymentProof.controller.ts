import { Request, Response } from "express";
import fs from "fs/promises";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import {
  PaymentProofError,
  savePaymentProof,
  findBranchProof,
  toPaymentProofView,
} from "../../services/payment/payment-proof.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

// UPI payment proof (#3): a photo of the customer's payment-success screen.
// Mounted for STAFF (/api/employee/payment/proof) and MANAGER
// (/api/branchManager/payment/proof — credit clearance). Branch-scoped: a
// proof can only be viewed and used in the branch it was taken in.

// POST …/payment/proof  (multipart, field "file")
export const UploadPaymentProof = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "FILE_REQUIRED",
        message: "Attach the photo of the customer's payment screen in the 'file' field.",
      });
    }
    const actor = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { publicId: true, branchId: true },
    });
    const branchId = req.branch_Id ?? actor?.branchId ?? null;
    if (!actor || branchId == null) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(StatusCode.UNAUTHORIZED).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not found",
      });
    }

    const proof = await savePaymentProof({
      tmpPath: req.file.path,
      branchId,
      uploaderPublicId: actor.publicId,
    });

    staffActivityService
      .logFromRequest(req, {
        actionType: StaffActionType.UPLOADED,
        entityType: StaffEntityType.PAYMENT_TRANSACTION,
        entityRef: proof.publicId,
        description: "UPI payment proof photo captured",
        metadata: { proofFileId: proof.publicId },
      })
      .catch(() => {});

    return res.status(StatusCode.CREATED).json({
      success: true,
      message: "Payment photo saved",
      data: proof,
    });
  } catch (err) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    if (err instanceof PaymentProofError) {
      return res.status(err.status).json(err.toJSON());
    }
    console.error("[PaymentProof] UploadPaymentProof:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "PAYMENT_PROOF_FAILED",
      message: "Could not save the payment photo. Please try again.",
    });
  }
};

// GET …/payment/proof/:proofFileId — a fresh 15-minute URL for a proof of this branch
export const GetPaymentProof = async (req: Request, res: Response) => {
  try {
    const file = await findBranchProof(String(req.params.proofFileId ?? ""), req.branch_Id);
    if (!file) {
      return res.status(StatusCode.NOT_FOUND).json({
        success: false,
        code: "PAYMENT_PROOF_NOT_FOUND",
        message: "Payment photo not found",
      });
    }
    return res.status(StatusCode.OK).json({ success: true, data: await toPaymentProofView(file) });
  } catch (err) {
    console.error("[PaymentProof] GetPaymentProof:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      code: "PAYMENT_PROOF_FAILED",
      message: "Could not load the payment photo. Please try again.",
    });
  }
};
