import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  RefreshCw,
  CalendarClock,
  AlertTriangle,
  Users,
  Car,
  Settings,
} from "lucide-react";

export const QuickActions = () => {
  const actions = [
    {
      label: "Vehicle Swaps",
      description: "View or perform vehicle swaps",
      icon: RefreshCw,
      href: "#swaps",
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      hoverColor: "hover:bg-orange-100",
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        document
          .getElementById("recent-swaps-section")
          ?.scrollIntoView({ behavior: "smooth" });
      },
    },
    {
      label: "Active Bookings",
      description: "View today's pickups",
      icon: CalendarClock,
      href: "#active-bookings",
      color: "text-green-600",
      bgColor: "bg-green-50",
      hoverColor: "hover:bg-green-100",
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        document
          .getElementById("active-bookings-section")
          ?.scrollIntoView({ behavior: "smooth" });
      },
    },
    {
      label: "Damage Reports",
      description: "Review pending reports",
      icon: AlertTriangle,
      href: "#damage-reports",
      color: "text-red-600",
      bgColor: "bg-red-50",
      hoverColor: "hover:bg-red-100",
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        document
          .getElementById("damage-reports-section")
          ?.scrollIntoView({ behavior: "smooth" });
      },
    },
    {
      label: "Manage Vehicles",
      description: "Add or edit vehicles",
      icon: Car,
      href: "/manager/vehicles",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      hoverColor: "hover:bg-blue-100",
    },
    {
      label: "Employees",
      description: "Manage staff members",
      icon: Users,
      href: "/manager/employees",
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      hoverColor: "hover:bg-purple-100",
    },
    {
      label: "Settings",
      description: "Branch settings",
      icon: Settings,
      href: "/manager/deposit-rules",
      color: "text-gray-600",
      bgColor: "bg-gray-50",
      hoverColor: "hover:bg-gray-100",
    },
  ];

  return (
    <Card className="border shadow-sm bg-gradient-to-br from-white to-neutral-50">
      <CardContent className="p-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-neutral-900">Quick Actions</h2>
          <p className="text-sm text-neutral-500">
            Fast access to common tasks
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {actions.map((action) => {
            const Icon = action.icon;
            const content = (
              <div
                className={`flex flex-col items-center justify-center p-4 rounded-lg border ${action.bgColor} ${action.hoverColor} transition-all cursor-pointer group`}
              >
                <div
                  className={`p-3 rounded-full ${action.bgColor} ${action.color} mb-2 group-hover:scale-110 transition-transform`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-neutral-900 text-center">
                  {action.label}
                </span>
                <span className="text-[10px] text-neutral-500 text-center mt-1 line-clamp-1">
                  {action.description}
                </span>
              </div>
            );

            if (action.onClick) {
              return (
                <a
                  key={action.label}
                  href={action.href}
                  onClick={action.onClick}
                >
                  {content}
                </a>
              );
            }

            return (
              <Link key={action.label} to={action.href}>
                {content}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
