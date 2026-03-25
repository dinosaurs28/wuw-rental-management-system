import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CalendarCheck, FileText, User, LogOut, Car } from "lucide-react";

const menuItems = [
  {
    title: "My Bookings",
    path: "/my-bookings",
    icon: CalendarCheck,
  },
  {
    title: "Documents",
    path: "/documents",
    icon: FileText,
  },
  {
    title: "Profile",
    path: "/profile",
    icon: User,
  },
];

export function DashboardSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const handleLogout = async () => {
    await logout();
    navigate("/auth/sign-in");
  };

  return (
    <Sidebar className="!bg-transparent p-4 border-none">
      <div className="flex h-full w-full flex-col rounded-[2rem] bg-white border border-zinc-200 shadow-sm overflow-hidden relative overflow-y-auto scrollbar-hide">

        {/* Sidebar Header with Logo */}
        <SidebarHeader className="border-b border-zinc-100 pt-8 pb-6 px-6">
          <Link to="/" className="flex items-center gap-4 group">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white transition-transform duration-300 group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(255,95,0,0.3)]">
              <Car className="h-5 w-5" />
            </div>
            <div
              className={cn(
                "flex flex-col overflow-hidden transition-all duration-300",
                isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100",
              )}
            >
              <span className="text-lg font-black tracking-widest uppercase text-zinc-900 leading-none mb-1">
                WUW
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 leading-none">
                Rentals
              </span>
            </div>
          </Link>
        </SidebarHeader>

        {/* Main Navigation */}
        <SidebarContent className="px-3 py-6">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {menuItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className={cn(
                          "h-12 rounded-2xl transition-all duration-300 group mb-1",
                          isActive
                            ? "!bg-orange-500 !text-white shadow-md"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                        )}
                      >
                        <Link
                          to={item.path}
                          className="flex items-center gap-4 px-2"
                        >
                          <item.icon
                            className={cn(
                              "h-5 w-5 transition-transform duration-300",
                              isActive ? "scale-110" : "group-hover:scale-110",
                            )}
                          />
                          <span
                            className={cn(
                              "font-medium tracking-wide",
                              isActive ? "font-bold" : "",
                            )}
                          >
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Sidebar Footer with Logout */}
        <SidebarFooter className="border-t border-zinc-100 p-4 mt-auto">
          <div className="flex flex-col gap-2">
            {user && !isCollapsed && (
              <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-sm font-bold text-zinc-900 tracking-wide">
                    {user.name || "User"}
                  </span>
                  <span className="truncate text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                    User Account
                  </span>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              className="w-full h-11 justify-start gap-4 rounded-xl text-zinc-500 hover:bg-red-50 hover:text-red-500 transition-all duration-300 group px-3"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" />
              <span className="font-medium tracking-wide">Sign Out</span>
            </Button>
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
