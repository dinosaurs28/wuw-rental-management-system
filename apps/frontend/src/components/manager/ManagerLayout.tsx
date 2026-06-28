import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  ChevronDown,
  LayoutDashboard,
  Car,
  Users,
  Camera,
  DollarSign,
  RefreshCcw,
  UserX,
  Repeat2,
  Tag,
  Settings2,
  BookOpen,
  Activity,
  Clock,
  ShieldCheck,
  LogOut,
  User,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { paymentService } from "@/services/payment.service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import apiClient from "@/lib/axios";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useBranchManagerAuthStore } from "@/store/branchManagerAuth.store";
import { usePaymentStore } from "@/store/payment.store";
import { cn } from "@/lib/utils";

interface ManagerLayoutProps {
  children: ReactNode;
}

const financialsItems = [
  { label: "Financials", path: "/manager/payment/financials", icon: DollarSign },
  { label: "Payment Recheck", path: "/manager/payment/recheck", icon: RefreshCcw },
  { label: "Extensions", path: "/manager/payment/extensions", icon: Repeat2 },
  { label: "Discounts", path: "/manager/payment/discounts", icon: Tag },
  { label: "Charge Settings", path: "/manager/charge-config", icon: Settings2 },
  { label: "Ledger", path: "/manager/ledger", icon: BookOpen },
];

const operationsItems = [
  { label: "Photo Capture", path: "/manager/capture-configs", icon: Camera },
  { label: "Branch Hours", path: "/manager/branch-schedule", icon: Clock },
  { label: "Cancellations", path: "/manager/no-show", icon: UserX },
  { label: "Staff Activity", path: "/manager/staff-activity", icon: Activity },
];

const topLevelItems = [
  { label: "Dashboard", path: "/manager/dashboard", icon: LayoutDashboard },
  { label: "Fleet", path: "/manager/fleet", icon: Truck },
  { label: "Vehicles", path: "/manager/vehicles", icon: Car },
  { label: "Employees", path: "/manager/employees", icon: Users },
];

function NavBadge({ count, variant = "orange" }: { count: number; variant?: "orange" | "red" }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] text-white text-[10px] font-bold rounded-full px-1 leading-none",
        variant === "red" ? "bg-red-500" : "bg-orange-500"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavDropdown({
  label,
  items,
  badge,
  badgeVariant = "orange",
  isAnyActive,
}: {
  label: string;
  items: { label: string; path: string; icon: React.ElementType }[];
  badge?: number;
  badgeVariant?: "orange" | "red";
  isAnyActive: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "relative flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors outline-none select-none",
            isAnyActive
              ? "bg-orange-50 text-orange-600"
              : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
          )}
        >
          {label}
          {badge !== undefined && badge > 0 && (
            <NavBadge count={badge} variant={badgeVariant} />
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52 mt-1">
        {items.map((item) => (
          <DropdownMenuItem key={item.path} asChild>
            <Link
              to={item.path}
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <item.icon className="h-4 w-4 text-neutral-400" />
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const ManagerLayout = ({ children }: ManagerLayoutProps) => {
  const { user, logout } = useBranchManagerAuthStore();
  const { pendingCashCount, pendingRefundCount, setPendingCashCount } = usePaymentStore();
  const [insuranceAlertCount, setInsuranceAlertCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    paymentService.getPendingCash(1, 1)
      .then((res) => setPendingCashCount(res.total || 0))
      .catch(() => {});
  }, [location.pathname, setPendingCashCount]);

  useEffect(() => {
    apiClient.get("/insurance-alerts/counts")
      .then((res) => setInsuranceAlertCount(res.data?.data?.total ?? 0))
      .catch(() => {});
  }, []);

  const isActive = (path: string) => location.pathname === path;
  const isAnyFinancialsActive = financialsItems.some((i) => isActive(i.path));
  const isAnyOpsActive = operationsItems.some((i) => isActive(i.path));
  const financialsBadge = pendingCashCount + pendingRefundCount;

  const handleLogout = () => {
    logout();
    navigate("/branch-manager/sign-in");
  };

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      {/* Top Navbar */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">

          {/* Left: Logo + Nav */}
          <div className="flex items-center gap-6 min-w-0">
            {/* Logo */}
            <Link to="/manager/dashboard" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-sm">
                <span className="text-white font-bold text-base leading-none">S</span>
              </div>
              <span className="font-bold text-lg tracking-tight hidden lg:block">
                WUW{" "}
                <span className="text-neutral-400 font-normal">Manager</span>
              </span>
            </Link>

            {/* Divider */}
            <div className="hidden md:block w-px h-6 bg-neutral-200 shrink-0" />

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-0.5 flex-wrap">
              {/* Top-level standalone items */}
              {topLevelItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors",
                    isActive(item.path)
                      ? "bg-orange-50 text-orange-600"
                      : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              ))}

              {/* Operations dropdown */}
              <NavDropdown
                label="Operations"
                items={operationsItems}
                isAnyActive={isAnyOpsActive}
              />

              {/* Financials dropdown — with badge */}
              <NavDropdown
                label="Financials"
                items={financialsItems}
                badge={financialsBadge}
                badgeVariant="orange"
                isAnyActive={isAnyFinancialsActive}
              />

              {/* Insurance & Permit — standalone with red badge */}
              <Link
                to="/manager/insurance-expiry"
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors",
                  isActive("/manager/insurance-expiry")
                    ? "bg-orange-50 text-orange-600"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Insurance &amp; Permit
                {insuranceAlertCount > 0 && (
                  <NavBadge count={insuranceAlertCount} variant="red" />
                )}
              </Link>
            </nav>
          </div>

          {/* Right: User + Mobile trigger */}
          <div className="flex items-center gap-3 shrink-0">
            {/* User Profile - Desktop */}
            <div className="hidden md:flex items-center gap-3 pl-4 border-l border-neutral-200">
              <div className="text-right">
                <p className="text-sm font-medium leading-none text-neutral-800">
                  {user?.name || "Manager"}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5 capitalize">
                  {user?.role || "Branch Manager"}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Avatar className="w-9 h-9 border-2 border-orange-100 bg-orange-50 cursor-pointer hover:opacity-80 transition-opacity">
                    <AvatarImage src="" alt={user?.name || "Manager"} />
                    <AvatarFallback className="text-orange-600 font-semibold text-sm bg-orange-50">
                      {user?.name?.charAt(0)?.toUpperCase() || "M"}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-sm">{user?.name || "Manager"}</span>
                      <span className="text-xs text-neutral-500 capitalize">{user?.role || "Branch Manager"}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/manager/profile")} className="cursor-pointer">
                    <User className="h-4 w-4 mr-2" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Mobile Menu */}
            <div className="md:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="-mr-1">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px] p-0 flex flex-col">
                  <SheetHeader className="p-5 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-orange-500 rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">S</span>
                      </div>
                      <span className="text-base font-bold">WUW Manager</span>
                    </SheetTitle>
                  </SheetHeader>

                  {/* Section labels in mobile */}
                  <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                    <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                      Main
                    </p>
                    {topLevelItems.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          isActive(item.path)
                            ? "bg-orange-50 text-orange-600"
                            : "text-neutral-600 hover:bg-neutral-100"
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    ))}

                    <div className="pt-3">
                      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                        Operations
                      </p>
                      {operationsItems.map((item) => (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={cn(
                            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            isActive(item.path)
                              ? "bg-orange-50 text-orange-600"
                              : "text-neutral-600 hover:bg-neutral-100"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      ))}
                    </div>

                    <div className="pt-3">
                      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400 flex items-center gap-2">
                        Financials
                        {financialsBadge > 0 && (
                          <NavBadge count={financialsBadge} variant="orange" />
                        )}
                      </p>
                      {financialsItems.map((item) => (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={cn(
                            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            isActive(item.path)
                              ? "bg-orange-50 text-orange-600"
                              : "text-neutral-600 hover:bg-neutral-100"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      ))}
                    </div>

                    <div className="pt-3">
                      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                        Compliance
                      </p>
                      <Link
                        to="/manager/insurance-expiry"
                        className={cn(
                          "flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          isActive("/manager/insurance-expiry")
                            ? "bg-orange-50 text-orange-600"
                            : "text-neutral-600 hover:bg-neutral-100"
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <ShieldCheck className="h-4 w-4 shrink-0" />
                          Insurance &amp; Permit
                        </span>
                        {insuranceAlertCount > 0 && (
                          <NavBadge count={insuranceAlertCount} variant="red" />
                        )}
                      </Link>
                    </div>
                  </div>

                  {/* Mobile footer */}
                  <div className="p-4 border-t bg-neutral-50">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="w-9 h-9 border bg-orange-50">
                        <AvatarImage src="" alt={user?.name || "Manager"} />
                        <AvatarFallback className="text-orange-600 font-semibold text-sm bg-orange-50">
                          {user?.name?.charAt(0)?.toUpperCase() || "M"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{user?.name || "Manager"}</p>
                        <p className="text-xs text-neutral-500 capitalize truncate">
                          {user?.role || "Branch Manager"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full justify-center text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-2"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main>{children}</main>
    </div>
  );
};
