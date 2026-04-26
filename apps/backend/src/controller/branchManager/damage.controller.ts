import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  DamageReportStatus,
  VehicleStatus,
  PaymentStatus,
  InvoiceStatus,
  DepositMethod,
  VehicleReturnDisposition,
  PaymentPurpose,
  PaymentMethod,
} from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { damageChargeService } from "../../services/damage/damage-charge.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";
import { auditService, AuditCategory, AuditSeverity } from "../../services/audit/audit.service.js";
import { closeDamageReportSchema } from "@repo/schemas";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import { checkPhonePeStatus } from "../../utils/payment/paymentStatus.utils.js";

export const GetDamageReports = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { date } = req.query;

  let dateFilter: any = {};
  let dateKey: string | undefined = "all";

  if (date) {
    const targetDate = new Date(date as string);
    if (!isNaN(targetDate.getTime())) {
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      dateFilter = {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      };
      dateKey = targetDate.toISOString().split("T")[0] as string;
    }
  }

  try {
    const cacheKey = `branch:${branchId}:damage_reports:${dateKey}:${page}:${limit}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      return res.status(StatusCode.OK).json({
        message: "Damage reports fetched successfully (cached)",
        data: JSON.parse(cachedData),
      });
    }

    const whereCondition = {
      booking: {
        branchId: branchId,
      },
      damageCharges: {
        gt: 0,
      },
      ...dateFilter,
    };

    const totalCount = await prisma.invoice.count({
      where: whereCondition,
    });

    const reports = await prisma.invoice.findMany({
      where: whereCondition,
      select: {
        id: true,
        publicId: true,
        damageCharges: true,
        total: true,
        createdAt: true,
        booking: {
          select: {
            publicId: true,
            customer: {
              select: {
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
            items: {
              select: {
                vehicle: {
                  select: {
                    make: true,
                    model: true,
                    regNo: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: skip,
    });

    const responseData = {
      reports,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(responseData));

    return res.status(StatusCode.OK).json({
      message: "Damage reports fetched successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Damage Reports Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error fetching damage reports",
    });
  }
};

export const GetDamageReportList = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const whereCondition: any = {
      booking: {
        branchId: branchId,
      },
    };

    const searchInput = req.query.search as string;

    if (searchInput) {
      const isNumeric = /^\d+$/.test(searchInput);

      if (isNumeric) {
        // strict ID search
        whereCondition.id = parseInt(searchInput);
      } else {
        // text search on RegNo
        whereCondition.vehicle = {
          regNo: { contains: searchInput, mode: "insensitive" },
        };
      }
    }

    const reports = await prisma.damageReport.findMany({
      where: whereCondition,
      select: {
        id: true,
        publicId: true, // Added to fix lint error
        status: true,
        createdAt: true,
        vehicle: {
          select: {
            regNo: true,
            make: true,
            model: true,
            images: {
              where: { isThumbnail: true },
              select: {
                file: {
                  select: { url: true },
                },
              },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: skip,
    });

    const totalCount = await prisma.damageReport.count({
      where: whereCondition,
    });

    const responseData = {
      reports: reports.map((r) => ({
        ...r,
        publicId: r.publicId || undefined, // Prisma returns null if optional, but here we mapped ID. Wait, I should check if publicId is in select.
        // Looking at select in lines 164-183: id, status, createdAt, vehicle.
        // It does NOT select publicId. I must add it to select first.
        vehicle: {
          ...r.vehicle,
          image: r.vehicle.images[0]?.file.url || null,
        },
      })),
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    };

    return res.status(StatusCode.OK).json({
      message: "Damage reports fetched successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Error fetching damage report list:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const GetMinimalDamageReport = async (req: Request, res: Response) => {
  try {
    const { damageReportId } = req.params;
    const branchId = req.branch_Id;

    if (!damageReportId) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Damage Report ID is required" });
    }

    const isId = !isNaN(Number(damageReportId));
    const whereCondition = isId
      ? { id: Number(damageReportId) }
      : { publicId: damageReportId };

    const report = await prisma.damageReport.findUnique({
      where: whereCondition,
      select: {
        publicId: true,
        status: true,
        chargeType: true,
        estimatedCost: true,
        notes: true,
        createdAt: true,
        booking: {
          select: {
            publicId: true,
            totalDeposit: true,
            branchId: true,
            branch: {
              select: {
                gstRule: { select: { cgstRate: true, sgstRate: true } },
              },
            },
          },
        },
        vehicle: {
          select: {
            regNo: true,
            make: true,
            model: true,
            status: true,
          },
        },
        photos: {
          where: {
            type: "DAMAGE",
          },
          select: {
            file: {
              select: {
                url: true,
              },
            },
          },
        },
      },
    });

    if (!report) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Damage Report not found" });
    }

    // Access Rule: Manager.branchId must match booking.branchId
    if (report.booking.branchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: This report belongs to another branch",
      });
    }

    const gstRule = report.booking.branch.gstRule;
    const cgstRate = gstRule ? Number(gstRule.cgstRate) : 9;
    const sgstRate = gstRule ? Number(gstRule.sgstRate) : 9;

    // Transform response to match strict format
    const responseData = {
      damageReportId: report.publicId,
      status: report.status,
      chargeType: report.chargeType ?? "PENALTY",
      booking: {
        bookingId: report.booking.publicId,
        deposit: Number(report.booking.totalDeposit),
      },
      vehicle: {
        regNo: report.vehicle.regNo,
        make: report.vehicle.make,
        model: report.vehicle.model,
        currentStatus: report.vehicle.status,
      },
      damageDetails: report.notes,
      images: report.photos.map((p) => ({ url: p.file.url })),
      financialHint: {
        deposit: Number(report.booking.totalDeposit),
        estimatedCost: Number(report.estimatedCost),
        gstRate: cgstRate + sgstRate,
      },
    };

    return res.status(StatusCode.OK).json(responseData);
  } catch (error) {
    console.error("Error fetching minimal damage report:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

export const CloseDamageReport = async (req: Request, res: Response) => {
  try {
    const validation = closeDamageReportSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid inputs",
        errors: validation.error.errors,
      });
    }

    const { disposition, finalCost, paymentMethod } = validation.data;
    const damageReportId = req.params.damageReportId;
    const managerId = req.public_Id;
    const branchId = req.branch_Id;

    const isId = !isNaN(Number(damageReportId));
    const whereCondition = isId
      ? { id: Number(damageReportId) }
      : { publicId: damageReportId };

    // 1. Fetch Report & Related Entities
    const damageReport = await prisma.damageReport.findUnique({
      where: whereCondition,
      include: {
        booking: {
          include: {
            deposit: true,
            invoice: true,
          },
        },
        vehicle: true,
      },
    });

    if (!damageReport) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Damage Report not found" });
    }

    const booking = damageReport.booking;

    // 2. Validations
    if (booking.branchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: Booking belongs to a different branch",
      });
    }

    if (damageReport.status !== ("PENDING" as DamageReportStatus)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot close report. Current status: ${damageReport.status}`,
      });
    }

    // 3. Financial Calculation
    const depositAmount = Number(booking.totalDeposit);

    // chargeType is authoritative from what staff set during damage report creation
    const activeChargeType = damageReport.chargeType ?? "PENALTY";
    
    // Calculate the tax
    const taxCalculation = await damageChargeService.calculateDamageTax(
      finalCost,
      activeChargeType,
      branchId
    );
    
    // Total fine includes tax
    const fineAmountInclTax = finalCost + taxCalculation.taxAmount;
    const balance = depositAmount - fineAmountInclTax; // Positive = Refund, Negative = Due

    const managerUser = await prisma.user.findUnique({
      where: { publicId: managerId },
      select: { id: true, name: true, role: true },
    });

    if (!managerUser)
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "Manager not found" });

    // 4. Prepare Payment Data (Outside Transaction)
    let paymentUrl: string | null = null;
    let onlineTransactionId: string | null = null;
    let dueAmount = 0;

    if (balance < 0) {
      dueAmount = Math.abs(balance);
      if (!paymentMethod) {
        return res
          .status(StatusCode.BAD_REQUEST)
          .json({ message: "Payment method required for due amount" });
      }

      if (paymentMethod === "ONLINE_RAZORPAY") {
        const customRedirectUrl = `${process.env.FRONTEND_REDIRECT_URL}/manager/payment/fine-status`;

        try {
          // Initiate Payment First (Network IO)
          const responseIdx = await initiatePhonePePayment(
            dueAmount,
            customRedirectUrl,
          );
          if (!responseIdx || !responseIdx.merchantTransactionId) {
            throw new Error("Invalid payment response from gateway");
          }
          onlineTransactionId = responseIdx.merchantTransactionId;
          paymentUrl = responseIdx.instrumentResponse?.redirectInfo?.url;
        } catch (error: any) {
          console.error("Error initiating damage fine payment:", error);
          return res.status(StatusCode.BAD_REQUEST).json({
            success: false,
            message: error.message || "Failed to initiate payment gateway",
          });
        }
      }
    }

    // 5. Transaction
    let isFullySettled = false;

    await prisma.$transaction(async (tx) => {
      // Update Report first
      await tx.damageReport.update({
        where: { id: damageReport.id },
        data: {
          finalCost: finalCost,
          disposition: disposition as VehicleReturnDisposition,
          chargeType: activeChargeType,
          approvedById: managerUser.id,
          status: "APPROVED" as DamageReportStatus,
        },
      });

      if (balance >= 0) {
        // Refund or Exact Match
        if (balance > 0 && booking.deposit) {
          await tx.deposit.update({
            where: { id: booking.deposit.id },
            data: {
              isRefunded: true,
              refundedAt: new Date(),
              refundMethod: "CASH",
            },
          });
        }

        // Record fine as settled from deposit in financials
        await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `damage-settled:${damageReport.publicId}`,
            bookingId: booking.id,
            branchId: booking.branchId,
            purpose: PaymentPurpose.DAMAGE_FEE,
            method: PaymentMethod.CASH,
            status: "CONFIRMED",
            totalAmount: fineAmountInclTax.toFixed(2),
            cashAmount: fineAmountInclTax.toFixed(2),
            onlineAmount: "0.00",
            collectedById: managerUser.id,
            collectedAt: new Date(),
            confirmedById: managerUser.id,
            confirmedAt: new Date(),
            notes: `Damage fine settled from deposit — report ${damageReport.publicId}`,
          },
        });

        isFullySettled = true;
      } else {
        // Due Amount
        const dueAmount = Math.abs(balance);

        if (!paymentMethod) {
          throw new Error("Payment method required for due amount");
        }

        if (paymentMethod === "CASH") {
          if (booking.invoice) {
            await tx.payment.create({
              data: {
                publicId: createID(),
                invoiceId: booking.invoice.id,
                method: DepositMethod.CASH,
                amount: dueAmount,
                status: PaymentStatus.SUCCESS,
              },
            });

            await tx.paymentTransaction.create({
              data: {
                publicId: createID(),
                idempotencyKey: `damage-cash:${damageReport.publicId}`,
                bookingId: booking.id,
                branchId: booking.branchId,
                purpose: PaymentPurpose.DAMAGE_FEE,
                method: PaymentMethod.CASH,
                status: "COLLECTED",
                totalAmount: dueAmount.toFixed(2),
                cashAmount: dueAmount.toFixed(2),
                onlineAmount: "0.00",
                collectedById: managerUser.id,
                collectedAt: new Date(),
                notes: `Damage fine collected (cash) — report ${damageReport.publicId}`,
              },
            });

            isFullySettled = true;
          }
        } else if (paymentMethod === "ONLINE_RAZORPAY") {
          if (booking.invoice && onlineTransactionId) {
            await tx.payment.create({
              data: {
                publicId: createID(),
                invoiceId: booking.invoice.id,
                method: DepositMethod.ONLINE_RAZORPAY,
                amount: dueAmount,
                // Store transaction ID for verification mapping
                razorpayOrderId: onlineTransactionId,
                status: PaymentStatus.CREATED,
              },
            });

            await tx.paymentTransaction.create({
              data: {
                publicId: createID(),
                idempotencyKey: `damage-online:${damageReport.publicId}`,
                bookingId: booking.id,
                branchId: booking.branchId,
                purpose: PaymentPurpose.DAMAGE_FEE,
                method: PaymentMethod.ONLINE,
                status: "INITIATED",
                totalAmount: dueAmount.toFixed(2),
                cashAmount: "0.00",
                onlineAmount: dueAmount.toFixed(2),
                onlineTransactionRef: onlineTransactionId,
                collectedById: managerUser.id,
                notes: `Damage fine (online pending) — report ${damageReport.publicId}`,
              },
            });
          }
          isFullySettled = false;
        }
      }

      // 6. Add Damage Charge to Invoice
      if (booking.invoice) {
        await damageChargeService.addDamageChargeToInvoice(
          tx,
          booking.invoice.id,
          finalCost,
          activeChargeType,
          `Damage Charge: ${damageReport.publicId}`,
          taxCalculation.taxAmount
        );
      }

      // Update Booking Total
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          totalFinal: { increment: fineAmountInclTax },
        },
      });

      // 7. Finalize if Settled
      if (isFullySettled) {
        if (booking.invoice) {
          await tx.invoice.update({
            where: { id: booking.invoice.id },
            data: {
              status: InvoiceStatus.PAID,
            },
          });
        }

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.RETURNED,
          },
        });

        let nextVehicleStatus: VehicleStatus = VehicleStatus.AVAILABLE;
        if (disposition === "MAINTENANCE")
          nextVehicleStatus = VehicleStatus.MAINTENANCE;
        if (disposition === "DAMAGED")
          nextVehicleStatus = VehicleStatus.INACTIVE;

        await tx.vehicle.update({
          where: { id: damageReport.vehicleId },
          data: { status: nextVehicleStatus },
        });
      }

    }, { timeout: 30000 });

    // Activity log and audit are non-critical — run outside transaction to avoid timeout
    await staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.COMPLETED,
      entityType: StaffEntityType.DAMAGE_REPORT,
      entityRef: damageReport.publicId,
      description: `Damage report ${damageReport.publicId} closed`,
    });

    await auditService.log({
      actorId: managerUser.id,
      actorName: managerUser.name,
      actorRole: managerUser.role,
      actorBranchId: branchId,
      action: "DAMAGE_COST_ASSESSED",
      category: AuditCategory.PAYMENT,
      severity: AuditSeverity.WARNING,
      description: `Damage cost of ₹${finalCost} assessed for vehicle ${damageReport.vehicle.regNo} (booking ${booking.publicId})`,
      entity: "DamageReport",
      entityId: damageReport.publicId,
      entityLabel: damageReport.vehicle.regNo,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { damageDescription: damageReport.notes, amount: finalCost, disposition, chargeType: activeChargeType },
    });

    if (isFullySettled) {
      return res.status(StatusCode.OK).json({
        message: "Damage Report Closed & Booking Settled",
        refunded: balance > 0,
        settled: true,
      });
    } else {
      return res.status(StatusCode.OK).json({
        message: "Payment Required to Settle Booking",
        paymentUrl: paymentUrl,
        settled: false,
      });
    }
  } catch (error: any) {
    console.error("Error closing damage report:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Internal Server Error",
    });
  }
};

export const CheckDamagePaymentStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: "Transaction ID is required" });
    }

    // 1. Find Payment
    const payment = await prisma.payment.findFirst({
      where: { razorpayOrderId: transactionId },
      include: {
        invoice: {
          include: {
            booking: {
              include: {
                damages: true, // To get vehicleId and damage report
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Payment record not found" });
    }

    // 2. Check Status from Provider
    const statusResponse = await checkPhonePeStatus(transactionId);

    // Example PhonePe Success: { success: true, code: "PAYMENT_SUCCESS", ... }
    const isSuccess =
      statusResponse?.success === true &&
      statusResponse?.code === "PAYMENT_SUCCESS";

    if (payment.status === "SUCCESS") {
      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: "Payment already verified",
        settled: true,
      });
    }

    if (isSuccess) {
      // 3. Settle everything
      await prisma.$transaction(async (tx) => {
        // Update Payment
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCESS,
            razorpayPaymentId:
              statusResponse.data?.paymentInstrument?.cardTransactionId ||
              "ONLINE_SUCCESS", // Store provider ref
          },
        });

        // Confirm the PaymentTransaction in financials
        await tx.paymentTransaction.updateMany({
          where: { onlineTransactionRef: transactionId },
          data: {
            status: "CONFIRMED",
            confirmedAt: new Date(),
          },
        });

        // Get Booking and Damage Report References
        const invoice = payment.invoice;
        const booking = invoice.booking;

        // The invoice was ALREADY updated with damageCharges by CloseDamageReport.
        // We just mark it as PAID.
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.PAID,
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.RETURNED,
          },
        });

        // Update Vehicle Status
        // Fetch proper damage report
        const dr = await tx.damageReport.findFirst({
          where: { bookingId: booking.id },
          orderBy: { createdAt: "desc" },
        });

        if (dr) {
          let nextVehicleStatus: VehicleStatus = VehicleStatus.AVAILABLE;
          if (dr.disposition === "MAINTENANCE")
            nextVehicleStatus = VehicleStatus.MAINTENANCE;
          if (dr.disposition === "DAMAGED")
            nextVehicleStatus = VehicleStatus.INACTIVE;

          await tx.vehicle.update({
            where: { id: dr.vehicleId },
            data: { status: nextVehicleStatus },
          });
        }
      });

      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: "Payment verified and booking settled",
      });
    } else {
      // Payment Failed or Pending
      return res.status(StatusCode.OK).json({
        status: "FAILURE",
        message: "Payment not successful",
        details: statusResponse,
      });
    }
  } catch (error: any) {
    console.error("Payment Verification Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal Error" });
  }
};

export const UpdateDamageChargeType = async (req: Request, res: Response) => {
  try {
    const { damageReportId } = req.params;
    const { chargeType } = req.body;
    const branchId = req.branch_Id;

    if (!damageReportId) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Damage Report ID is required" });
    }

    if (chargeType !== "PENALTY" && chargeType !== "COMPENSATION") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid charge type. Must be PENALTY or COMPENSATION." });
    }

    const isId = !isNaN(Number(damageReportId));
    const whereCondition = isId
      ? { id: Number(damageReportId) }
      : { publicId: damageReportId };

    const report = await prisma.damageReport.findUnique({
      where: whereCondition,
      include: { booking: true },
    });

    if (!report) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Damage Report not found" });
    }

    if (report.booking.branchId !== branchId) {
      return res.status(StatusCode.FORBIDDEN).json({
        message: "Access Denied: This report belongs to another branch",
      });
    }

    if (report.status !== "PENDING") {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot update charge type. Current status: ${report.status}`,
      });
    }

    const updatedReport = await damageChargeService.updateDamageChargeType(
      report.id,
      chargeType
    );

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.DAMAGE_REPORT,
      entityRef: report.publicId,
      description: `Damage report ${report.publicId} charge type updated to ${chargeType}`,
      metadata: { chargeType },
    });

    return res.status(StatusCode.OK).json({
      message: "Damage charge type updated successfully",
      data: updatedReport,
    });
  } catch (error) {
    console.error("Error updating damage charge type:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
