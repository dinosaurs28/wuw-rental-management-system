import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface ChargeModuleToggleProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  children?: ReactNode;
}

export function ChargeModuleToggle({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  description,
  enabled,
  onToggle,
  children,
}: ChargeModuleToggleProps) {
  return (
    <div
      className={`rounded-lg border transition-all duration-200 overflow-hidden ${
        enabled
          ? "border-orange-200 bg-orange-50/30"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}
        >
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{title}</p>
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${
            enabled ? "bg-orange-500" : "bg-neutral-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Sub-options panel */}
      {enabled && children && (
        <div className="px-5 pb-5 pt-0 border-t border-orange-100/60">
          <div className="pt-4 space-y-4">{children}</div>
        </div>
      )}
    </div>
  );
}
