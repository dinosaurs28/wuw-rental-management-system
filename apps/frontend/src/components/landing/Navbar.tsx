import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LucideBookDashed, LucideLogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { useAuthStore } from "@/store/auth.store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Navbar = () => {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const navigate = useNavigate();
    const { isAuthenticated, user, logout } = useAuthStore();

    const handleLogout = async () => {
        await logout();
        navigate("/");
    };

    const getInitials = (name?: string) => {
        if (!name) return "U";
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <nav className="sticky top-0 z-50 w-full bg-zinc-950/90 backdrop-blur-xl border-b border-white/5">
            <div className="container mx-auto flex h-16 md:h-18 items-center justify-between px-4 lg:px-8">
                {/* Brand */}
                <Link to="/" className="flex items-center gap-2.5 group">
                    <div className="flex aspect-square size-9 items-center justify-center rounded-lg bg-orange-500 text-white shadow-lg shadow-orange-500/25 group-hover:shadow-orange-500/40 transition-all duration-300">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="size-5"
                        >
                            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                            <circle cx="7" cy="17" r="2" />
                            <path d="M9 17h6" />
                            <circle cx="17" cy="17" r="2" />
                        </svg>
                    </div>
                    <span className="text-lg font-bold tracking-tight text-white group-hover:text-orange-500 transition-colors duration-200">VRMS</span>
                </Link>

                {/* Desktop Navigation Links */}
                <div className="hidden md:flex items-center gap-1">
                    <Link to="#" className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200">Fleet</Link>
                    <Link to="#" className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200">Locations</Link>
                    <Link to="#" className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200">Business</Link>
                    <Link to="#" className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-all duration-200">Subscription</Link>
                </div>

                {/* Auth Section */}
                <div className="flex items-center gap-3">
                    {isAuthenticated ? (
                        /* Authenticated User - Avatar with Dropdown */
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="flex items-center gap-2 p-1 rounded-full hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-zinc-950">
                                    <Avatar className="size-9 border-2 border-orange-500/50">
                                        <AvatarFallback className="bg-orange-500 text-white font-semibold text-sm">
                                            {getInitials(user?.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 bg-zinc-900 border-zinc-800 text-white">
                                <div className="px-3 py-2">
                                    <p className="text-sm font-medium">{user?.name || "User"}</p>
                                    <p className="text-xs text-zinc-400 truncate">{user?.email}</p>
                                </div>
                                <DropdownMenuSeparator className="bg-zinc-800" />
                                <DropdownMenuItem
                                    onClick={() => navigate("/dashboard")}
                                    className="cursor-pointer hover:bg-white/10 focus:bg-white/10"
                                >
                                    <LucideBookDashed></LucideBookDashed>
                                    My Dashboard
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-zinc-800" />
                                <DropdownMenuItem
                                    onClick={handleLogout}
                                    className="cursor-pointer text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 focus:text-red-400"
                                >
                                    <LucideLogOut></LucideLogOut>
                                    Logout
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        /* Guest User - Sign In / Register */
                        <>
                            <Link
                                to="/auth/sign-in"
                                className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-medium text-white hover:text-orange-500 transition-colors duration-200"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
                                    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
                                </svg>
                                Sign In
                            </Link>
                            <Button
                                asChild
                                className="hidden sm:inline-flex h-9 bg-white text-zinc-900 hover:bg-zinc-100 font-semibold rounded-lg px-5 text-sm shadow-sm"
                            >
                                <Link to="/auth/sign-up">Register</Link>
                            </Button>
                        </>
                    )}

                    {/* Mobile Menu Toggle */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                        aria-label="Toggle menu"
                    >
                        {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden border-t border-white/5 bg-zinc-950/95 backdrop-blur-xl">
                    <div className="container mx-auto px-4 py-4 space-y-1">
                        <Link to="#" className="block px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg transition-all">Fleet</Link>
                        <Link to="#" className="block px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg transition-all">Locations</Link>
                        <Link to="#" className="block px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg transition-all">Business</Link>
                        <Link to="#" className="block px-4 py-3 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg transition-all">Subscription</Link>
                        <div className="pt-4 border-t border-white/5 space-y-2">
                            {isAuthenticated ? (
                                <>
                                    <Link to="/dashboard" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-white hover:bg-white/5 rounded-lg transition-all">
                                        <span className="font-hugeicons text-lg">&#988926;</span>
                                        My Dashboard
                                    </Link>
                                    <button
                                        onClick={handleLogout}
                                        className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                    >
                                        <span className="font-hugeicons text-lg">&#990038;</span>
                                        Logout
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link to="/auth/sign-in" className="block px-4 py-3 text-sm font-medium text-white hover:bg-white/5 rounded-lg transition-all">Sign In</Link>
                                    <Link to="/auth/sign-up" className="block px-4 py-3 text-sm font-semibold text-center text-zinc-900 bg-white hover:bg-zinc-100 rounded-lg transition-all">Register</Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};
