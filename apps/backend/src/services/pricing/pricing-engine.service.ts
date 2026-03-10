import { prisma } from '@repo/database/client';
import { DateTime } from 'luxon';
import Decimal from 'decimal.js';
import { DurationCalculatorService, RentalPeriodType, RentalDuration } from './duration-calculator.service';

/**
 * Vehicle pricing configuration
 */
export interface VehiclePricing {
  hourlyRate: Decimal | null;
  price12Hour: Decimal | null;
  price24Hour: Decimal;
  priceMonthly: Decimal | null;
  freeKm12Hour: number;
  freeKm24Hour: number;
  freeKmMonthly: number;
  extraKmRate: Decimal;
  extraHourRate: Decimal;
}

/**
 * Pricing calculation result
 */
export interface PricingResult {
  // Base pricing
  basePrice: Decimal;
  discountAmount: Decimal;
  discountPercent: Decimal;
  
  // Deposits & fees
  deposit: Decimal;
  
  // Tax breakdown
  taxAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  taxRate: Decimal;
  
  // Final amounts
  finalTotal: Decimal;
  
  // Distance limits
  freeKmLimit: number;
  extraKmRate: Decimal;
  
  // Breakdown details
  pricingBreakdown: {
    periodType: RentalPeriodType;
    duration: RentalDuration;
    applicablePrice: Decimal;
    priceSource: 'vehicle_custom' | 'branch_default' | 'fallback';
  };
}

/**
 * Discount slab application result
 */
interface DiscountResult {
  finalAmount: Decimal;
  discountAmount: Decimal;
  discountPercent: Decimal;
  slabApplied?: {
    days: number;
    multiplier: Decimal;
  };
}

/**
 * Tax calculation result
 */
interface TaxResult {
  totalTax: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  rate: Decimal;
}

/**
 * Service for calculating booking prices
 */
export class PricingEngineService {
  
  /**
   * Calculate complete booking price
   * 
   * @param vehicleId - ID of the vehicle
   * @param startAt - Rental start datetime (IST)
   * @param endAt - Rental end datetime (IST)
   * @param branchId - Branch ID
   * @returns Complete pricing breakdown
   */
  async calculateBookingPrice(
    vehicleId: number,
    startAt: DateTime,
    endAt: DateTime,
    branchId: number
  ): Promise<PricingResult> {
    
    // 1. Calculate rental duration
    const duration = DurationCalculatorService.calculate(startAt, endAt);
    
    // 2. Get vehicle pricing (custom or branch default)
    const pricing = await this.getVehiclePricing(vehicleId, branchId);
    
    // 3. Determine base price based on duration
    const { basePrice, freeKmLimit, priceSource } = await this.determineBasePrice(
      pricing,
      duration,
      vehicleId,
      branchId
    );
    
    // 4. Apply discount slabs for multi-day bookings
    const discountResult = await this.applyDiscountSlabs(
      basePrice,
      duration.days,
      branchId,
      vehicleId
    );
    
    // 5. Get deposit amount
    const deposit = await this.getDepositAmount(vehicleId, branchId);
    
    // 6. Calculate tax on discounted amount
    const taxResult = await this.calculateTax(
      discountResult.finalAmount,
      branchId
    );
    
    // 7. Calculate final total
    const finalTotal = discountResult.finalAmount.add(taxResult.totalTax);
    
    return {
      basePrice,
      discountAmount: discountResult.discountAmount,
      discountPercent: discountResult.discountPercent,
      deposit,
      taxAmount: taxResult.totalTax,
      cgstAmount: taxResult.cgst,
      sgstAmount: taxResult.sgst,
      taxRate: taxResult.rate,
      finalTotal,
      freeKmLimit,
      extraKmRate: pricing.extraKmRate,
      pricingBreakdown: {
        periodType: duration.periodType,
        duration,
        applicablePrice: basePrice,
        priceSource: pricing.source as any
      }
    };
  }
  
  /**
   * Get vehicle pricing (custom or branch default)
   * Priority: Vehicle Custom > Branch Default > Error
   */
  private async getVehiclePricing(
    vehicleId: number,
    branchId: number
  ): Promise<VehiclePricing & { source: 'vehicle_custom' | 'branch_default' }> {
    
    // Try to get vehicle custom pricing first
    const customPricing = await prisma.vehicleCustomPricing.findUnique({
      where: { vehicleId }
    });
    
    if (customPricing && customPricing.enabled) {
      return {
        hourlyRate: customPricing.hourlyRate ? new Decimal(customPricing.hourlyRate.toString()) : null,
        price12Hour: customPricing.price12Hour ? new Decimal(customPricing.price12Hour.toString()) : null,
        price24Hour: new Decimal(customPricing.price24Hour.toString()),
        priceMonthly: customPricing.priceMonthly ? new Decimal(customPricing.priceMonthly.toString()) : null,
        freeKm12Hour: customPricing.freeKm12Hour,
        freeKm24Hour: customPricing.freeKm24Hour,
        freeKmMonthly: customPricing.freeKmMonthly,
        extraKmRate: new Decimal(customPricing.extraKmRate.toString()),
        extraHourRate: new Decimal(customPricing.extraHourRate.toString()),
        source: 'vehicle_custom'
      };
    }
    
    // Fall back to branch defaults
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true }
    });
    
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }
    
    const branchDefaults = await prisma.branchPricingDefaults.findUnique({
      where: {
        branchId_categoryId: {
          branchId,
          categoryId: vehicle.categoryId
        }
      }
    });
    
    if (!branchDefaults) {
      throw new Error(`No pricing configured for this vehicle category at branch ${branchId}`);
    }
    
    return {
      hourlyRate: branchDefaults.hourlyRate ? new Decimal(branchDefaults.hourlyRate.toString()) : null,
      price12Hour: branchDefaults.price12Hour ? new Decimal(branchDefaults.price12Hour.toString()) : null,
      price24Hour: new Decimal(branchDefaults.price24Hour.toString()),
      priceMonthly: branchDefaults.priceMonthly ? new Decimal(branchDefaults.priceMonthly.toString()) : null,
      freeKm12Hour: branchDefaults.freeKm12Hour,
      freeKm24Hour: branchDefaults.freeKm24Hour,
      freeKmMonthly: branchDefaults.freeKmMonthly,
      extraKmRate: new Decimal(branchDefaults.extraKmRate.toString()),
      extraHourRate: new Decimal(branchDefaults.extraHourRate.toString()),
      source: 'branch_default'
    };
  }
  
  /**
   * Determine base price based on rental duration
   */
  private async determineBasePrice(
    pricing: VehiclePricing & { source: string },
    duration: RentalDuration,
    vehicleId: number,
    branchId: number
  ): Promise<{ basePrice: Decimal; freeKmLimit: number; priceSource: string }> {
    
    let basePrice: Decimal;
    let freeKmLimit: number;
    
    switch (duration.periodType) {
      case RentalPeriodType.HOURLY:
        if (!pricing.hourlyRate) {
          throw new Error('Hourly rental not available for this vehicle');
        }
        basePrice = pricing.hourlyRate.mul(duration.billableDuration);
        freeKmLimit = Math.floor(duration.billableDuration * 8); // ~8 km per hour
        break;
        
      case RentalPeriodType.HALF_DAY:
        if (!pricing.price12Hour) {
          throw new Error('12-hour rental not available for this vehicle');
        }
        basePrice = pricing.price12Hour;
        freeKmLimit = pricing.freeKm12Hour;
        break;
        
      case RentalPeriodType.FULL_DAY:
        basePrice = pricing.price24Hour;
        freeKmLimit = pricing.freeKm24Hour;
        break;
        
      case RentalPeriodType.MULTI_DAY:
        const days = duration.days;
        // Base calculation: days * daily price
        // Discount will be applied in next step
        basePrice = pricing.price24Hour.mul(days);
        freeKmLimit = pricing.freeKm24Hour * days;
        break;
        
      case RentalPeriodType.MONTHLY:
        if (pricing.priceMonthly) {
          basePrice = pricing.priceMonthly;
          freeKmLimit = pricing.freeKmMonthly;
        } else {
          // Fallback: 30 days at daily rate
          basePrice = pricing.price24Hour.mul(30);
          freeKmLimit = pricing.freeKm24Hour * 30;
        }
        break;
        
      default:
        throw new Error('Invalid rental period type');
    }
    
    return {
      basePrice,
      freeKmLimit,
      priceSource: pricing.source
    };
  }
  
  /**
   * Apply discount slabs for multi-day bookings
   * Priority: Category-specific > Branch-level
   */
  private async applyDiscountSlabs(
    basePrice: Decimal,
    days: number,
    branchId: number,
    vehicleId: number
  ): Promise<DiscountResult> {
    
    // Get vehicle category
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true }
    });
    
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }
    
    // Try category-specific slab first
    let slab = await prisma.pricingDiscountSlab.findFirst({
      where: {
        categoryId: vehicle.categoryId,
        days: { lte: days }
      },
      orderBy: {
        days: 'desc'  // Get the highest applicable slab
      }
    });
    
    // Fall back to branch-level slab
    if (!slab) {
      slab = await prisma.pricingDiscountSlab.findFirst({
        where: {
          branchId,
          categoryId: null,
          days: { lte: days }
        },
        orderBy: {
          days: 'desc'
        }
      });
    }
    
    // If no slab found or multiplier is 1.0, no discount
    if (!slab || new Decimal(slab.multiplier.toString()).equals(1)) {
      return {
        finalAmount: basePrice,
        discountAmount: new Decimal(0),
        discountPercent: new Decimal(0)
      };
    }
    
    const multiplier = new Decimal(slab.multiplier.toString());
    const finalAmount = basePrice.mul(multiplier);
    const discountAmount = basePrice.sub(finalAmount);
    const discountPercent = new Decimal(1).sub(multiplier).mul(100);
    
    return {
      finalAmount,
      discountAmount,
      discountPercent,
      slabApplied: {
        days: slab.days,
        multiplier
      }
    };
  }
  
  /**
   * Get deposit amount for vehicle category
   */
  private async getDepositAmount(
    vehicleId: number,
    branchId: number
  ): Promise<Decimal> {
    
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { categoryId: true }
    });
    
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }
    
    const depositSetting = await prisma.categoryDepositSetting.findUnique({
      where: {
        branchId_categoryId: {
          branchId,
          categoryId: vehicle.categoryId
        }
      }
    });
    
    // Default to 5000 if not configured
    return depositSetting 
      ? new Decimal(depositSetting.amount.toString())
      : new Decimal(0);
  }
  
  /**
   * Calculate GST (CGST + SGST)
   */
  private async calculateTax(
    amount: Decimal,
    branchId: number
  ): Promise<TaxResult> {
    
    const gstRule = await prisma.gSTRule.findUnique({
      where: { branchId }
    });
    
    if (!gstRule) {
      throw new Error('GST rules not configured for this branch');
    }
    
    const cgstRate = new Decimal(gstRule.cgstRate.toString());
    const sgstRate = new Decimal(gstRule.sgstRate.toString());
    const totalRate = cgstRate.add(sgstRate);
    
    const cgst = amount.mul(cgstRate).div(100);
    const sgst = amount.mul(sgstRate).div(100);
    const totalTax = cgst.add(sgst);
    
    return {
      totalTax,
      cgst,
      sgst,
      rate: totalRate
    };
  }
  
  /**
   * Calculate extra km charges
   * 
   * @param kmDriven - Total kilometers driven
   * @param freeKmLimit - Free kilometers included
   * @param extraKmRate - Rate per extra km
   * @returns Extra km charge amount
   */
  calculateExtraKmCharges(
    kmDriven: number,
    freeKmLimit: number,
    extraKmRate: Decimal
  ): Decimal {
    const extraKm = Math.max(0, kmDriven - freeKmLimit);
    return extraKmRate.mul(extraKm);
  }
  
  /**
   * Calculate extra hour charges (for late returns)
   * 
   * @param extraHours - Number of extra hours
   * @param hourlyRate - Rate per hour
   * @returns Extra hour charge amount
   */
  calculateExtraHourCharges(
    extraHours: number,
    hourlyRate: Decimal
  ): Decimal {
    return hourlyRate.mul(extraHours);
  }
}

export default PricingEngineService;
