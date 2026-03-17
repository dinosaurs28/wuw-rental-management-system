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
    <header className="sticky top-0 z-40 flex h-20 shrink-0 items-center justify-between border-b border-white/5 bg-transparent px-4 md:px-8 backdrop-blur-md">
      {/* Left side - Sidebar trigger (mobile) + Breadcrumb area */}
      <div className="flex items-center gap-4">
        <SidebarTrigger className="md:hidden text-zinc-400 hover:text-white transition-colors" />
        <div className="hidden md:block">
          <h2 className="text-xl font-serif font-bold text-white tracking-tight">
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
              className="flex items-center gap-3 px-2 py-1.5 h-auto rounded-full hover:bg-white/5 transition-all duration-300"
            >
              <Avatar className="h-10 w-10 border border-white/10 shadow-sm">
                <AvatarFallback className="bg-zinc-900 text-white font-medium text-sm">
                  {user?.name ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-semibold text-white md:inline-block">
                {user?.name || "User"}
              </span>
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            </Button>
          </DropdownMenuTrigger>
          {/* Theming the dropdown for dark mode */}
          <DropdownMenuContent
            align="end"
            className="w-56 bg-zinc-900/95 backdrop-blur-xl border-white/10 text-zinc-50 rounded-2xl shadow-2xl p-2"
          >
            <div className="flex items-center gap-3 p-3">
              <Avatar className="h-12 w-12 border border-white/10">
                <AvatarFallback className="bg-zinc-800 text-white">
                  {user?.name ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-base font-bold text-white">
                  {user?.name || "User"}
                </span>
                <span className="truncate text-xs font-medium text-zinc-400">
                  {user?.email || ""}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator className="bg-white/10 my-1" />
            <DropdownMenuItem
              onClick={() => navigate("/profile")}
              className="cursor-pointer rounded-xl hover:bg-white/10 focus:bg-white/10 focus:text-white p-3 transition-colors"
            >
              <User className="mr-3 h-4 w-4 text-zinc-400" />
              <span className="font-medium">Profile Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10 my-1" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer rounded-xl text-red-400 focus:bg-red-500/10 focus:text-red-400 p-3 transition-colors"
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
