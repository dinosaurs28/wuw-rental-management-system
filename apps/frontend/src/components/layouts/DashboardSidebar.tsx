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
} from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth.store";
import { Button } from "@/components/ui/button";

// Using lucide-react icons as per the docs (stack.md mentions Huge Icons but they may not be installed)
import {
    CalendarCheck,
    FileText,
    User,
    LogOut,
    Car
} from "lucide-react";

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

    const handleLogout = async () => {
        await logout();
        navigate("/auth/sign-in");
    };

    return (
        <Sidebar>
            {/* Sidebar Header with Logo */}
            <SidebarHeader className="border-b border-sidebar-border">
                <Link to="/" className="flex items-center gap-2 px-2 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                        <Car className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-semibold text-sidebar-foreground">
                            WOW
                        </span>
                        <span className="text-xs text-muted-foreground">
                            Vehicle Rental
                        </span>
                    </div>
                </Link>
            </SidebarHeader>

            {/* Main Navigation */}
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {menuItems.map((item) => {
                                const isActive = location.pathname === item.path;
                                return (
                                    <SidebarMenuItem key={item.path}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            tooltip={item.title}
                                        >
                                            <Link to={item.path}>
                                                <item.icon className="h-4 w-4" />
                                                <span>{item.title}</span>
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
            <SidebarFooter className="border-t border-sidebar-border">
                <div className="flex flex-col gap-2 p-2">
                    {user && (
                        <div className="flex items-center gap-2 px-2 py-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                                <User className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="truncate text-sm font-medium text-sidebar-foreground">
                                    {user.name || "User"}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {user.email}
                                </span>
                            </div>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleLogout}
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Logout</span>
                    </Button>
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
