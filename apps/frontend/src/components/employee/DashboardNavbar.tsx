import { Link, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEmployeeAuthStore } from "@/store/employeeAuth.store";
import { LogOut, LayoutDashboard } from "lucide-react";
import { ShiftBanner } from "@/components/manager/payment/ShiftBanner";

export function DashboardNavbar() {
  const { user, logout } = useEmployeeAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/employee/sign-in");
  };

  return (
    <div className="sticky top-0 z-50">
      <header className="w-full bg-white border-b border-gray-200">
        {/* Aligned to same max-width and padding as page content */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex h-14 items-center justify-between gap-4">

          {/* Left: wordmark + nav */}
          <div className="flex items-center gap-8">
            <Link
              to="/employee/dashboard"
              className="text-lg font-bold tracking-tight text-black"
            >
              WUW <span style={{ color: "#FF5F00" }}>Staff</span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              <Link
                to="/employee/dashboard"
                className="text-sm font-semibold px-3 py-1 rounded-md transition-colors"
                style={{ color: "#FF5F00", background: "rgba(255,95,0,0.08)" }}
              >
                Dashboard
              </Link>
            </nav>
          </div>

          {/* Right: user dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="flex items-center gap-2.5 cursor-pointer rounded-full px-2 py-1 hover:bg-gray-100 transition-colors">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-sm font-semibold text-black leading-none">
                    {user?.name || "Employee"}
                  </span>
                  <span className="text-xs text-[#999999] mt-0.5">
                    {user?.email || "Staff"}
                  </span>
                </div>
                <Avatar className="h-8 w-8 border border-gray-200">
                  <AvatarImage src="" />
                  <AvatarFallback
                    className="text-white text-xs font-bold"
                    style={{ background: "#FF5F00" }}
                  >
                    {user?.name?.charAt(0)?.toUpperCase() || "E"}
                  </AvatarFallback>
                </Avatar>
              </div>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[#666666] text-xs font-medium">
                My Account
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate("/employee/dashboard")}
                className="cursor-pointer"
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Dashboard
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-red-600 focus:text-red-600 cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <ShiftBanner />
    </div>
  );
}
