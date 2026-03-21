import { prisma, BookingStatus, VehicleStatus, SwapReason, Booking, VehicleSwap, Vehicle, Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../audit/audit.service.js";
import { AuditCategory } from "@repo/database/client";

interface SwapEligibilityResult {
  eligible: boolean;
  reason?: string;
}

interface AvailableVehicle {
  id: number;
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: VehicleStatus;
  categoryId: number;
  categoryName: string;
  categoryRank: number;
  images: Array<{ url: string | null }>;
}

interface SwapHistoryFilters {
  bookingId?: number;
  vehicleId?: number;
  startDate?: Date;
  endDate?: Date;
  reason?: SwapReason;
}

export class VehicleSwapService {

  /**
   * Get available vehicles for swap
   * Must be from same branch, AVAILABLE status, and same or higher category rank
   */
  async getAvailableVehiclesForSwap(
    bookingId: string,
    branchId: number
  ): Promise<AvailableVehicle[]> {
    // Get the booking with current vehicle details
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      include: {
        items: {
          include: {
            vehicle: {
              include: {
                category: true,
              }
            }
          }
        }
      }
    });

    if (!booking) {
      throw new Error("Booking not found");
    }

    // Validate booking is eligible for swap
    const eligibility = await this.validateSwapEligibility(booking);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason || "Booking is not eligible for vehicle swap");
    }

    // Get current vehicle's category rank
    const currentVehicle = booking.items[0]?.vehicle;
    if (!currentVehicle) {
      throw new Error("No vehicle found in booking");
    }

    const currentCategoryRank = currentVehicle.category.rank;

    // Find available vehicles in same branch with same or higher category rank
    const availableVehicles = await prisma.vehicle.findMany({
      where: {
        branchId: branchId,
        status: VehicleStatus.AVAILABLE,
        deletedAt: null,
        id: { not: currentVehicle.id }, // Exclude current vehicle
        category: {
          rank: { gte: currentCategoryRank }
        }
      },
      include: {
        category: true,
        images: {
          where: { isThumbnail: true },
          take: 1,
          select: {
            file: {
              select: { url: true }
            }
          }
        }
      },
      orderBy: [
        { category: { rank: 'asc' } },
        { make: 'asc' },
        { model: 'asc' }
      ]
    });

    // Map to response format
    return availableVehicles.map(vehicle => ({
      id: vehicle.id,
      publicId: vehicle.publicId,
      make: vehicle.make,
      model: vehicle.model,
      regNo: vehicle.regNo,
      status: vehicle.status,
      categoryId: vehicle.categoryId,
      categoryName: vehicle.category.name,
      categoryRank: vehicle.category.rank,
      images: vehicle.images.map(img => ({ url: img.file.url }))
    }));
  }

  /**
   * Perform vehicle swap
   * Updates booking items, creates swap record, and updates vehicle statuses
   */
  async performVehicleSwap(
    bookingId: string,
    newVehicleId: number,
    swappedById: number,
    reason: SwapReason,
    reasonNotes?: string,
    markOriginalForMaintenance: boolean = false,
    originalVehicleNotes?: string
  ): Promise<VehicleSwap> {
    // Validate inputs
    if (!bookingId || !newVehicleId || !swappedById) {
      throw new Error("Missing required parameters");
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Get booking with current vehicle
      const booking = await tx.booking.findUnique({
        where: { publicId: bookingId },
        include: {
          items: {
            include: {
              vehicle: {
                include: { category: true }
              }
            }
          }
        }
      });

      if (!booking) {
        throw new Error("Booking not found");
      }

      // 2. Validate booking eligibility
      const eligibility = await this.validateSwapEligibility(booking);
      if (!eligibility.eligible) {
        throw new Error(eligibility.reason || "Booking is not eligible for swap");
      }

      const currentBookingItem = booking.items[0];
      if (!currentBookingItem) {
        throw new Error("No booking item found");
      }

      const originalVehicleId = currentBookingItem.vehicleId;

      // 3. Verify new vehicle exists and is available
      const newVehicle = await tx.vehicle.findUnique({
        where: { id: newVehicleId },
        include: { category: true }
      });

      if (!newVehicle) {
        throw new Error("New vehicle not found");
      }

      const isAvailable = await this.isVehicleAvailable(newVehicle, booking.startAt, booking.endAt, tx);
      if (!isAvailable) {
        throw new Error("New vehicle is not available for the booking period");
      }

      // 4. Validate category rank (new vehicle must be same or higher rank)
      const originalVehicle = currentBookingItem.vehicle;
      const categoryComparison = this.compareCategoryRank(
        originalVehicle.category.rank,
        newVehicle.category.rank
      );

      if (categoryComparison > 0) {
        throw new Error("Cannot swap to a lower category vehicle");
      }

      // 5. Update booking item with new vehicle
      await tx.bookingItem.update({
        where: { id: currentBookingItem.id },
        data: {
          vehicleId: newVehicleId
        }
      });

      // 6. Update vehicle statuses
      // Mark new vehicle as OUT_FOR_RENTAL
      await tx.vehicle.update({
        where: { id: newVehicleId },
        data: { status: VehicleStatus.OUT_FOR_RENTAL }
      });

      // Update original vehicle status
      const originalVehicleStatus = markOriginalForMaintenance
        ? VehicleStatus.MAINTENANCE
        : VehicleStatus.AVAILABLE;

      await tx.vehicle.update({
        where: { id: originalVehicleId },
        data: { status: originalVehicleStatus }
      });

      // 7. Create vehicle swap record
      const vehicleSwap = await tx.vehicleSwap.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          originalVehicleId: originalVehicleId,
          newVehicleId: newVehicleId,
          swappedById: swappedById,
          reason: reason,
          reasonNotes: reasonNotes,
          originalVehicleStatus: originalVehicleStatus,
          originalVehicleNotes: originalVehicleNotes,
          swappedAt: new Date()
        }
      });

      // 8. Create audit log
      const swapActor = await tx.user.findUnique({ where: { id: swappedById }, select: { name: true, role: true, branchId: true } });
      await auditService.log({
        actorId: swappedById,
        actorName: swapActor?.name ?? "Unknown",
        actorRole: swapActor?.role ?? Role.STAFF,
        actorBranchId: swapActor?.branchId ?? undefined,
        action: "VEHICLE_SWAP",
        category: AuditCategory.VEHICLE,
        description: `Vehicle swapped from ${originalVehicleId} to ${newVehicleId} for booking ${bookingId}`,
        entity: "Booking",
        entityId: bookingId.toString(),
        metadata: { originalVehicleId, newVehicleId, reason, markOriginalForMaintenance },
      }, tx);

      return vehicleSwap;
    }, {
      maxWait: 5000,
      timeout: 10000
    });
  }

  /**
   * Get swap history for a booking
   */
  async getSwapHistory(bookingId: number): Promise<VehicleSwap[]> {
    return await prisma.vehicleSwap.findMany({
      where: { bookingId },
      include: {
        originalVehicle: {
          select: {
            publicId: true,
            make: true,
            model: true,
            regNo: true
          }
        },
        newVehicle: {
          select: {
            publicId: true,
            make: true,
            model: true,
            regNo: true
          }
        },
        swappedBy: {
          select: {
            publicId: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { swappedAt: 'desc' }
    });
  }

  /**
   * Get swaps by date range with optional filters
   */
  async getSwapsByDateRange(
    branchId: number,
    startDate: Date,
    endDate: Date,
    filters?: SwapHistoryFilters
  ): Promise<VehicleSwap[]> {
    const where: any = {
      swappedAt: {
        gte: startDate,
        lte: endDate
      },
      booking: {
        branchId: branchId
      }
    };

    if (filters?.bookingId) {
      where.bookingId = filters.bookingId;
    }

    if (filters?.vehicleId) {
      where.OR = [
        { originalVehicleId: filters.vehicleId },
        { newVehicleId: filters.vehicleId }
      ];
    }

    if (filters?.reason) {
      where.reason = filters.reason;
    }

    return await prisma.vehicleSwap.findMany({
      where,
      include: {
        booking: {
          select: {
            publicId: true,
            customer: {
              select: {
                user: {
                  select: {
                    name: true,
                    email: true
                  }
                }
              }
            }
          }
        },
        originalVehicle: {
          select: {
            publicId: true,
            make: true,
            model: true,
            regNo: true
          }
        },
        newVehicle: {
          select: {
            publicId: true,
            make: true,
            model: true,
            regNo: true
          }
        },
        swappedBy: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { swappedAt: 'desc' }
    });
  }

  /**
   * Validate if booking is eligible for vehicle swap
   * Rules:
   * - Must be in CONFIRMED or PICKED_UP status
   * - Cannot swap after booking has ended
   * - Must have at least one booking item
   */
  private async validateSwapEligibility(booking: Booking & { items: any[] }): Promise<SwapEligibilityResult> {
    // Check booking status
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PICKED_UP) {
      return {
        eligible: false,
        reason: `Booking must be in CONFIRMED or PICKED_UP status. Current status: ${booking.status}`
      };
    }

    // Check if booking has ended
    const now = new Date();
    if (booking.endAt < now) {
      return {
        eligible: false,
        reason: "Cannot swap vehicle for a booking that has already ended"
      };
    }

    // Check if booking has items
    if (!booking.items || booking.items.length === 0) {
      return {
        eligible: false,
        reason: "Booking has no items"
      };
    }

    return { eligible: true };
  }

  /**
   * Check if vehicle is available for the given date range
   */
  private async isVehicleAvailable(
    vehicle: Pick<Vehicle, 'status' | 'deletedAt' | 'id'> | Vehicle,
    startDate: Date,
    endDate: Date,
    db: any = prisma
  ): Promise<boolean> {
    // Check vehicle status
    if (vehicle.status !== VehicleStatus.AVAILABLE) {
      return false;
    }

    // Check if vehicle is soft deleted
    if (vehicle.deletedAt) {
      return false;
    }

    // Check for overlapping bookings
    const overlappingBookings = await db.bookingItem.findFirst({
      where: {
        vehicleId: vehicle.id,
        booking: {
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.PICKED_UP]
          },
          OR: [
            {
              startAt: { lte: startDate },
              endAt: { gte: startDate }
            },
            {
              startAt: { lte: endDate },
              endAt: { gte: endDate }
            },
            {
              startAt: { gte: startDate },
              endAt: { lte: endDate }
            }
          ]
        }
      }
    });

    return !overlappingBookings;
  }

  /**
   * Compare category ranks
   * Returns: -1 if rank1 < rank2, 0 if equal, 1 if rank1 > rank2
   */
  private compareCategoryRank(rank1: number, rank2: number): number {
    if (rank1 < rank2) return -1;
    if (rank1 > rank2) return 1;
    return 0;
  }
}
