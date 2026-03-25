import { useNavigate } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, User, ChevronDown } from "lucide-react";

export function DashboardNavbar() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    navigate("/auth/sign-in");
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-40 flex h-20 shrink-0 items-center justify-between border-b border-zinc-200 bg-white/80 px-4 md:px-8 backdrop-blur-md">
      {/* Left side - Sidebar trigger (mobile) + Breadcrumb area */}
      <div className="flex items-center gap-4">
        <SidebarTrigger className="md:hidden text-zinc-500 hover:text-zinc-900 transition-colors" />
        <div className="hidden md:block">
          <h2 className="text-xl font-serif font-bold text-zinc-900 tracking-tight">
            Dashboard Overview
          </h2>
        </div>
      </div>

      {/* Right side - User menu */}
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-3 px-2 py-1.5 h-auto rounded-full hover:bg-zinc-100 transition-all duration-300"
            >
              <Avatar className="h-10 w-10 border border-zinc-200 shadow-sm">
                <AvatarFallback className="bg-zinc-100 text-zinc-700 font-medium text-sm">
                  {user?.name ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-semibold text-zinc-900 md:inline-block">
                {user?.name || "User"}
              </span>
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 bg-white backdrop-blur-xl border-zinc-200 text-zinc-900 rounded-2xl shadow-lg p-2"
          >
            <div className="flex items-center gap-3 p-3">
              <Avatar className="h-12 w-12 border border-zinc-200">
                <AvatarFallback className="bg-zinc-100 text-zinc-700">
                  {user?.name ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-base font-bold text-zinc-900">
                  {user?.name || "User"}
                </span>
                <span className="truncate text-xs font-medium text-zinc-500">
                  {user?.email || ""}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator className="bg-zinc-100 my-1" />
            <DropdownMenuItem
              onClick={() => navigate("/profile")}
              className="cursor-pointer rounded-xl hover:bg-zinc-50 focus:bg-zinc-50 focus:text-zinc-900 p-3 transition-colors"
            >
              <User className="mr-3 h-4 w-4 text-zinc-400" />
              <span className="font-medium">Profile Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-100 my-1" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer rounded-xl text-red-500 focus:bg-red-50 focus:text-red-500 p-3 transition-colors"
            >
              <LogOut className="mr-3 h-4 w-4" />
              <span className="font-medium">Log out securely</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
