import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useVehicleRentalStore } from '@/store/vehicleRental.store';
import { cn } from '@/lib/utils';
import { Shield } from 'lucide-react';

interface PriceBreakdownCardProps {
    className?: string;
}

export const PriceBreakdownCard = ({ className }: PriceBreakdownCardProps) => {
    const {
        rentalDays,
        totalPrice,
        deposit,
        grandBaseTotal,
        grandDiscountTotal,
        grandDeposit,
        grandFinalTotal,
    } = useVehicleRentalStore();

    // Use grand totals if available (after API call), otherwise use local calculations
    const basePrice = grandBaseTotal > 0 ? grandBaseTotal : totalPrice;
    const discountAmount = grandDiscountTotal;
    const depositAmount = grandDeposit > 0 ? grandDeposit : deposit;
    const finalTotal = grandFinalTotal > 0 ? grandFinalTotal : totalPrice + deposit;

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }).format(price);
    };

    return (
        <Card className={cn('bg-white border border-zinc-200 rounded-xl shadow-sm', className)}>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">Price Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Price Items */}
                <div className="space-y-3">
                    {/* Rental Duration */}
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                            Rental duration ({rentalDays} {rentalDays === 1 ? 'day' : 'days'})
                        </span>
                        <span className="font-medium text-foreground">
                            {formatPrice(basePrice)}
                        </span>
                    </div>

                    {/* Discount (if any) */}
                    {discountAmount > 0 && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-green-600">Discount</span>
                            <span className="font-medium text-green-600">
                                -{formatPrice(discountAmount)}
                            </span>
                        </div>
                    )}

                    {/* Security Deposit */}
                    {depositAmount > 0 && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Security Deposit</span>
                            <span className="font-medium text-foreground">
                                {formatPrice(depositAmount)}
                            </span>
                        </div>
                    )}
                </div>

                {/* Divider */}
                <div className="border-t border-zinc-200" />

                {/* Total */}
                <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-foreground">Total Price</span>
                    <span className="text-2xl font-bold text-primary">
                        {formatPrice(finalTotal)}
                    </span>
                </div>

                {/* Security Note */}
                <div className="flex items-center gap-2 pt-3 border-t border-zinc-100">
                    <Shield className="size-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                        Secure SSL encrypted payment
                    </span>
                </div>
            </CardContent>
        </Card>
    );
};
