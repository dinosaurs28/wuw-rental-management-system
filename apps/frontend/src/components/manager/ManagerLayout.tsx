import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

interface ManagerLayoutProps {
    children: ReactNode;
}

export const ManagerLayout = ({ children }: ManagerLayoutProps) => {
    const { user, logout } = useBranchManagerAuthStore();
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path: string) => location.pathname === path;

    const navItems = [
        { label: "Dashboard", path: "/manager/dashboard" },
        { label: "Vehicles", path: "/manager/vehicles" },
        { label: "Employees", path: "/manager/employees" },
    ];

    const handleLogout = () => {
        logout();
        navigate("/branch-manager/sign-in");
    };

    return (
        <div className="min-h-screen bg-neutral-50 pb-20">
            {/* Top Navbar */}
            <header className="bg-white border-b sticky top-0 z-30">
                <div className="max-w-[1440px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        {/* Logo */}
                        <Link to="/manager/dashboard" className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-orange-500 rounded-md flex items-center justify-center">
                                <span className="text-white font-bold text-lg">S</span>
                            </div>
                            <span className="font-bold text-xl tracking-tight hidden md:block">
                                WOW Rentals <span className="text-neutral-500 font-normal">Manager</span>
                            </span>
                        </Link>

                        {/* Desktop Nav */}
                        <nav className="hidden md:flex items-center gap-1">
                            {navItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${isActive(item.path)
                                        ? "bg-orange-50 text-orange-600"
                                        : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                                        }`}
                                >
                                    {item.label}
                                </Link>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* User Profile - Desktop */}
                        <div className="hidden md:flex items-center gap-3 pl-4 border-l">
                            <div className="text-right">
                                <p className="text-sm font-medium leading-none">{user?.name || 'Manager'}</p>
                                <p className="text-xs text-neutral-500 mt-1">{user?.role || 'Branch Manager'}</p>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Avatar className="w-9 h-9 border bg-orange-100 cursor-pointer hover:opacity-80 transition-opacity">
                                        <AvatarImage src="" alt={user?.name || 'Manager'} />
                                        <AvatarFallback className="text-orange-600 font-medium">
                                            {user?.name?.charAt(0) || 'M'}
                                        </AvatarFallback>
                                    </Avatar>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => navigate("/manager/dashboard")}>
                                        Dashboard
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => navigate("/manager/profile")}>
                                        Profile
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50" onClick={handleLogout}>
                                        Log Out
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Mobile Menu */}
                        <div className="md:hidden">
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button variant="ghost" size="icon" className="-mr-2">
                                        <Menu className="h-6 w-6" />
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="right" className="w-[300px] sm:w-[500px] p-0">
                                    <SheetHeader className="p-6 border-b text-left">
                                        <SheetTitle className="flex items-center gap-2">
                                            <div className="w-8 h-8 bg-orange-500 rounded-md flex items-center justify-center">
                                                <span className="text-white font-bold text-lg">S</span>
                                            </div>
                                            <span>WOW Manager</span>
                                        </SheetTitle>
                                    </SheetHeader>

                                    <div className="flex flex-col h-full pb-6">
                                        <div className="flex-1 py-6 px-4 space-y-2">
                                            {navItems.map((item) => (
                                                <Link
                                                    key={item.path}
                                                    to={item.path}
                                                    className={`flex items-center w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive(item.path)
                                                        ? "bg-orange-50 text-orange-600"
                                                        : "text-neutral-600 hover:bg-neutral-100"
                                                        }`}
                                                >
                                                    {item.label}
                                                </Link>
                                            ))}
                                            <div className="my-2 border-t border-neutral-100" />
                                            <Link
                                                to="/manager/profile"
                                                className={`flex items-center w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive('/manager/profile')
                                                    ? "bg-orange-50 text-orange-600"
                                                    : "text-neutral-600 hover:bg-neutral-100"
                                                    }`}
                                            >
                                                My Profile
                                            </Link>
                                        </div>

                                        {/* Mobile User Profile & Logout */}
                                        <div className="p-4 bg-neutral-50 mt-auto border-t">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Avatar className="w-10 h-10 border bg-orange-100">
                                                    <AvatarImage src="" alt={user?.name || 'Manager'} />
                                                    <AvatarFallback className="text-orange-600 font-medium">
                                                        {user?.name?.charAt(0) || 'M'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-medium text-sm">{user?.name || 'Manager'}</p>
                                                    <p className="text-xs text-neutral-500">{user?.role || 'Branch Manager'}</p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                className="w-full justify-center text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                                onClick={handleLogout}
                                            >
                                                Sign Out
                                            </Button>
                                        </div>
                                    </div>
                                </SheetContent>
                            </Sheet>
                        </div>
                    </div>
                </div>
            </header>

            {/* Page Content */}
            <main>
                {children}
            </main>
        </div>
    );
};
