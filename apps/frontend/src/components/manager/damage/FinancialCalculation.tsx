import React, { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, Banknote } from "lucide-react";
import type { DamageChargeType } from "@/services/damage.service";

interface FinancialCalculationProps {
  deposit: number;
  finalCost: number;
  setFinalCost: (amount: number) => void;
  paymentMethod?: "CASH" | "ONLINE_RAZORPAY";
  setPaymentMethod: (method: "CASH" | "ONLINE_RAZORPAY" | undefined) => void;
  chargeType: DamageChargeType;
  gstRate: number;
}

export const FinancialCalculation: React.FC<FinancialCalculationProps> = ({
  deposit,
  finalCost,
  setFinalCost,
  paymentMethod,
  setPaymentMethod,
  chargeType,
  gstRate,
}) => {
  const isPenalty = chargeType === "PENALTY";
  const taxAmount = isPenalty ? finalCost * (gstRate / 100) : 0;
  const totalDamage = finalCost + taxAmount;
  const balance = deposit - totalDamage;
  const isRefund = balance >= 0;
  const absBalance = Math.abs(balance);

  const [inputValue, setInputValue] = React.useState(finalCost.toString());

  useEffect(() => {
    if (isRefund) {
      setPaymentMethod(undefined);
    }
  }, [isRefund, setPaymentMethod]);

  useEffect(() => {
    if (Number(inputValue) !== finalCost) {
      setInputValue(finalCost.toString());
    }
  }, [finalCost]);

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      setInputValue(val);
      setFinalCost(val === "" ? 0 : parseFloat(val));
    }
  };

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground tracking-wide">
          Financial Settlement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Damage type indicator (set by staff — read-only) */}
        <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-4 py-3">
          <div>
            <p className="text-xs text-gray-500 font-medium">Damage Type (set by staff)</p>
            <p className="text-sm font-semibold mt-0.5">
              {isPenalty ? "Damage Penalty" : "Damage Compensation"}
            </p>
          </div>
          {isPenalty ? (
            <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
              Taxable ({gstRate}% GST)
            </Badge>
          ) : (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
              Non-taxable
            </Badge>
          )}
        </div>

        {/* Visual Math */}
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Customer Deposit</span>
            <span className="font-medium text-gray-900">{formatCurrency(deposit)}</span>
          </div>

          <div className="flex justify-between items-center items-end">
            <div className="space-y-1">
              <Label htmlFor="finalCost" className="text-red-900 font-semibold">
                Base Damage Cost
              </Label>
              <p className="text-[10px] text-gray-500">Enter amount assessed from review</p>
            </div>
            <div className="w-full max-w-[140px]">
              <Input
                id="finalCost"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={inputValue}
                onChange={handleCostChange}
                className="text-right font-bold text-red-600 border-red-300 bg-red-50 focus-visible:ring-red-500 h-10 text-lg"
              />
            </div>
          </div>

          {/* GST line — only for PENALTY */}
          {isPenalty && finalCost > 0 && (
            <div className="flex justify-between items-center text-sm text-orange-700 bg-orange-50 rounded px-2 py-1.5">
              <span>GST ({gstRate}%)</span>
              <span className="font-semibold">+ {formatCurrency(taxAmount)}</span>
            </div>
          )}

          {/* Total damage (base + tax) */}
          {isPenalty && finalCost > 0 && (
            <div className="flex justify-between items-center text-sm font-medium border-t border-gray-200 pt-2">
              <span className="text-gray-700">Total Damage Due</span>
              <span className="text-red-700 font-bold">{formatCurrency(totalDamage)}</span>
            </div>
          )}

          <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
            <span className="font-semibold text-gray-900">Net Balance</span>
            <div className={`text-lg font-bold ${isRefund ? "text-green-600" : "text-red-600"}`}>
              {isRefund ? "+" : "-"} {formatCurrency(absBalance)}
            </div>
          </div>

          <div
            className={`text-xs font-medium text-center p-1 rounded ${isRefund ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
          >
            {isRefund ? "REFUND TO CUSTOMER" : "CUSTOMER TO PAY"}
          </div>
        </div>

        {/* Payment Method Selection (Only if Due) */}
        {!isRefund && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <Label className="text-sm font-semibold">Select Payment Method</Label>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(val) => setPaymentMethod(val as "CASH" | "ONLINE_RAZORPAY")}
              className="grid grid-cols-2 gap-4"
            >
              <div>
                <RadioGroupItem value="CASH" id="pay-cash" className="peer sr-only" />
                <Label
                  htmlFor="pay-cash"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary cursor-pointer"
                >
                  <Banknote className="mb-2 h-6 w-6" />
                  Cash
                </Label>
              </div>
              <div>
                <RadioGroupItem value="ONLINE_RAZORPAY" id="pay-online" className="peer sr-only" />
                <Label
                  htmlFor="pay-online"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-transparent p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary cursor-pointer"
                >
                  <CreditCard className="mb-2 h-6 w-6" />
                  Online
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
