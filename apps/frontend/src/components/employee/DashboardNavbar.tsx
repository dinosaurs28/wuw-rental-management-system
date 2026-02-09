
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
import { LogOut, LayoutDashboard, Search, Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function DashboardNavbar() {
    const { user, logout } = useEmployeeAuthStore();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate("/employee/sign-in");
    };

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 items-center justify-between gap-4">
                <div className="flex items-center gap-8">
                    {/* Logo */}
                    <Link to="/employee/dashboard" className="flex items-center gap-2 font-bold text-xl min-w-fit">
                        {/* Orange Triangle Logo Mock */}
                        <div className="w-0 h-0 border-l-[8px] border-l-transparent border-b-[14px] border-b-primary border-r-[8px] border-r-transparent" />
                        <span>WOW Admin</span>
                    </Link>

                    {/* Navigation */}
                    <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
                        <Link to="/employee/dashboard" className="text-primary font-semibold">Dashboard</Link>
                    </nav>
                </div>

                <div className="flex items-center gap-4 flex-1 justify-end">
                    {/* User Profile */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <div className="flex items-center gap-3 cursor-pointer hover:bg-accent/50 p-1.5 rounded-full transition-colors pl-3 border sm:border-transparent">
                                <div className="hidden sm:flex flex-col items-end">
                                    <span className="text-sm font-semibold leading-none">{user?.name || "Employee"}</span>
                                    <span className="text-xs text-muted-foreground">{user?.email || "Manager"}</span>
                                </div>
                                <Avatar className="h-9 w-9 border-2 border-background shadow-sm">
                                    <AvatarImage src="" />
                                    <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                        {user?.name?.charAt(0) || "E"}
                                    </AvatarFallback>
                                </Avatar>
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>My Account</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate("/employee/dashboard")}>
                                <LayoutDashboard className="mr-2 h-4 w-4" />
                                Dashboard
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                                <LogOut className="mr-2 h-4 w-4" />
                                Log out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    );
}
