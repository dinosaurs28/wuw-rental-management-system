import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  AlertTriangle,
  Car,
  Users,
  Settings,
  CreditCard,
} from "lucide-react";

const actions = [
  {
    label: "Vehicle Extensions",
    icon: ArrowUpRight,
    href: "/manager/payment/extensions",
    accent: "#e85d04",
    bg: "#fff7ed",
    border: "#fed7aa",
  },
  {
    label: "Damage Reports",
    icon: AlertTriangle,
    href: "/manager/damage-reports",
    accent: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
  },
  {
    label: "Vehicles",
    icon: Car,
    href: "/manager/vehicles",
    accent: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
  },
  {
    label: "Employees",
    icon: Users,
    href: "/manager/employees",
    accent: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
  {
    label: "Financials",
    icon: CreditCard,
    href: "/manager/payment/financials",
    accent: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
  },
  {
    label: "Settings",
    icon: Settings,
    href: "/manager/charge-config",
    accent: "#4b5563",
    bg: "#f9fafb",
    border: "#e5e7eb",
  },
];

export const QuickActions = () => (
  <div>
    <p
      className="text-[10px] font-bold uppercase tracking-[0.14em] mb-3"
      style={{ color: "#9ca3af" }}
    >
      Quick Actions
    </p>
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {actions.map(({ label, icon: Icon, href, accent, bg, border }) => (
        <Link
          key={label}
          to={href}
          className="group flex flex-col items-center gap-2 rounded-xl border p-3 transition-all hover:shadow-md hover:-translate-y-0.5"
          style={{ backgroundColor: bg, borderColor: border }}
        >
          <div
            className="rounded-lg p-2 transition-transform group-hover:scale-110"
            style={{ backgroundColor: `${accent}18` }}
          >
            <Icon className="w-4 h-4" style={{ color: accent }} />
          </div>
          <span
            className="text-[10px] font-semibold text-center leading-tight"
            style={{ color: accent }}
          >
            {label}
          </span>
        </Link>
      ))}
    </div>
  </div>
);
