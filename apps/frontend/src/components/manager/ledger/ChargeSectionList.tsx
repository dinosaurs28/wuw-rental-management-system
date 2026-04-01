import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PlusCircle } from "lucide-react";
import type { ChargeSection } from "@/services/ledger.service";

function formatAmount(val: number) {
  return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  sections: ChargeSection[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  onAddCustomSection: (section: { sectionKey: string; label: string; amount: number }) => void;
}

export function ChargeSectionList({ sections, selectedKeys, onToggle, onAddCustomSection }: Props) {
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");

  function handleAddCustom() {
    const amount = parseFloat(customAmount);
    if (!customName.trim() || isNaN(amount) || amount <= 0) return;
    // Generate a unique key
    const key = `custom_${Math.random().toString(36).slice(2, 10)}`;
    onAddCustomSection({ sectionKey: key, label: customName.trim(), amount });
    setCustomName("");
    setCustomAmount("");
  }

  const isCustomValid = customName.trim().length > 0 && parseFloat(customAmount) > 0;

  return (
    <div className="space-y-4">
      {sections.length > 0 ? (
        <div className="space-y-2">
          {sections.map((section) => {
            const isDisabled = section.isCredited;
            const isChecked = selectedKeys.includes(section.sectionKey);

            return (
              <div
                key={section.sectionKey}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  isDisabled ? "bg-zinc-50 opacity-60" : "bg-white"
                }`}
              >
                <Checkbox
                  id={section.sectionKey}
                  checked={isChecked}
                  disabled={isDisabled}
                  onCheckedChange={() => onToggle(section.sectionKey)}
                />
                <Label
                  htmlFor={section.sectionKey}
                  className={`flex-1 text-sm cursor-pointer ${isDisabled ? "cursor-not-allowed" : ""}`}
                >
                  {section.label}
                  {isDisabled && (
                    <span className="ml-2 text-xs bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-full">
                      {section.isCleared ? "Cleared" : "Already credited"}
                    </span>
                  )}
                </Label>
                <span className="text-sm font-medium text-zinc-700 shrink-0">
                  {formatAmount(section.amount)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 text-center py-4">No charge entries found for this booking.</p>
      )}

      {/* Custom section form */}
      <div className="rounded-xl border border-dashed border-zinc-300 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Add Custom Section</p>
        <div className="flex gap-2">
          <Input
            placeholder="Section name"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="flex-1 text-sm"
          />
          <Input
            placeholder="Amount"
            type="number"
            min={0}
            step={0.01}
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-28 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isCustomValid}
            onClick={handleAddCustom}
            className="shrink-0"
          >
            <PlusCircle className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
