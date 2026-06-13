import React, { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CreditCard, Banknote, SplitSquareHorizontal } from "lucide-react";
import type { DamageChargeType } from "@/services/damage.service";

export type DamagePaymentMethod = "CASH" | "ONLINE_RAZORPAY" | "SPLIT";

interface FinancialCalculationProps {
  deposit: number;
  additionalCharges: number;
  finalCost: number;
  setFinalCost: (amount: number) => void;
  paymentMethod?: DamagePaymentMethod;
  setPaymentMethod: (method: DamagePaymentMethod | undefined) => void;
  cashAmount: number;
  setCashAmount: (v: number) => void;
  onlineAmount: number;
  setOnlineAmount: (v: number) => void;
  onlineTransactionRef: string;
  setOnlineTransactionRef: (v: string) => void;
  chargeType: DamageChargeType;
  gstRate: number;
}

export const FinancialCalculation: React.FC<FinancialCalculationProps> = ({
  deposit,
  additionalCharges,
  finalCost,
  setFinalCost,
  paymentMethod,
  setPaymentMethod,
  cashAmount,
  setCashAmount,
  onlineAmount,
  setOnlineAmount,
  onlineTransactionRef,
  setOnlineTransactionRef,
  chargeType,
  gstRate,
}) => {
  const isPenalty = chargeType === "PENALTY";
  const taxAmount = isPenalty ? finalCost * (gstRate / 100) : 0;
  const totalDamage = finalCost + taxAmount;
  // net = additionalCharges + damageCharge - safetyDeposit
  const net = additionalCharges + totalDamage - deposit;
  const isRefund = net <= 0;
  const absNet = Math.abs(net);

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

  // Auto-fill split amounts when method changes or absNet changes
  useEffect(() => {
    if (paymentMethod === "SPLIT" && cashAmount === 0 && onlineAmount === 0) {
      setCashAmount(absNet);
    }
  }, [paymentMethod]);

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || /^\d*\.?\d*$/.test(val)) {
      setInputValue(val);
      setFinalCost(val === "" ? 0 : parseFloat(val));
    }
  };

  const methods: { value: DamagePaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: "CASH", label: "Cash", icon: <Banknote className="mb-1 h-5 w-5" /> },
    { value: "ONLINE_RAZORPAY", label: "Online", icon: <CreditCard className="mb-1 h-5 w-5" /> },
    { value: "SPLIT", label: "Split", icon: <SplitSquareHorizontal className="mb-1 h-5 w-5" /> },
  ];

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase text-muted-foreground tracking-wide">
          Financial Settlement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Damage type indicator */}
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
          {/* Safety deposit */}
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Safety Deposit</span>
            <span className="font-medium text-blue-700">− {formatCurrency(deposit)}</span>
          </div>

          {/* Additional charges from return */}
          {additionalCharges > 0 && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Additional Return Charges</span>
              <span className="font-medium text-orange-700">+ {formatCurrency(additionalCharges)}</span>
            </div>
          )}

          {/* Damage cost input */}
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <Label htmlFor="finalCost" className="text-red-900 font-semibold text-sm">
                Damage Charge
              </Label>
              <p className="text-[10px] text-gray-500">Enter assessed damage amount</p>
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

          {/* GST line */}
          {isPenalty && finalCost > 0 && (
            <div className="flex justify-between items-center text-sm text-orange-700 bg-orange-50 rounded px-2 py-1.5">
              <span>GST ({gstRate}%)</span>
              <span className="font-semibold">+ {formatCurrency(taxAmount)}</span>
            </div>
          )}

          {/* Net balance */}
          <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
            <span className="font-semibold text-gray-900 text-sm">Net Balance</span>
            <div className={`text-lg font-bold ${isRefund ? "text-green-600" : "text-red-600"}`}>
              {isRefund ? "Refund" : "Pay"} {formatCurrency(absNet)}
            </div>
          </div>

          <div
            className={`text-xs font-medium text-center p-1.5 rounded ${isRefund ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
          >
            {isRefund
              ? `REFUND ₹${absNet.toFixed(2)} TO CUSTOMER`
              : `CUSTOMER TO PAY ₹${absNet.toFixed(2)}`}
          </div>
        </div>

        {/* Payment Method Selection (Only if Due) */}
        {!isRefund && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <Label className="text-sm font-semibold">Select Payment Method</Label>
            <div className="grid grid-cols-3 gap-3">
              {methods.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPaymentMethod(m.value)}
                  className={`flex flex-col items-center justify-center rounded-md border-2 p-3 transition-all cursor-pointer text-sm font-medium ${
                    paymentMethod === m.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>

            {/* Online transaction ref */}
            {paymentMethod === "ONLINE_RAZORPAY" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Transaction / UPI Reference <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. UPI ref / txn ID"
                  value={onlineTransactionRef}
                  onChange={(e) => setOnlineTransactionRef(e.target.value)}
                  className="h-10"
                />
              </div>
            )}

            {/* Split payment */}
            {paymentMethod === "SPLIT" && (
              <div className="space-y-3 p-3 rounded-lg bg-neutral-50 border">
                <p className="text-xs text-muted-foreground font-medium">
                  Split total: {formatCurrency(absNet)}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cash Amount (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={cashAmount || ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setCashAmount(v);
                        setOnlineAmount(Math.max(0, absNet - v));
                      }}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Online Amount (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={onlineAmount || ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setOnlineAmount(v);
                        setCashAmount(Math.max(0, absNet - v));
                      }}
                      className="h-10"
                    />
                  </div>
                </div>
                {onlineAmount > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">UPI / Transaction ID <span className="text-red-500">*</span></Label>
                    <Input
                      placeholder="e.g. UPI ref / txn ID"
                      value={onlineTransactionRef}
                      onChange={(e) => setOnlineTransactionRef(e.target.value)}
                      className="h-10"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
