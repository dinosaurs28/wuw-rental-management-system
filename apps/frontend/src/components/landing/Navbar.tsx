import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LucideBookDashed, LucideLogOut, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";

export const Navbar = () => {
    const navigate = useNavigate();
    const { isAuthenticated, logout, checkAuth } = useAuthStore();
    const [isScrolled, setIsScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        checkAuth();
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, [checkAuth]);

    const handleLogout = () => {
        logout();
        navigate("/");
        setMobileMenuOpen(false);
    };

    return (
        <header className="fixed top-0 left-0 right-0 z-50 px-4 md:px-6 lg:px-8 py-6 pointer-events-none transition-all duration-300">
            <div className="max-w-[1600px] mx-auto pointer-events-auto">
                <div 
                    className={`
                        flex items-center justify-between mx-auto rounded-[2rem] md:rounded-full px-6 md:px-8 transition-all duration-500
                        ${isScrolled 
                            ? "bg-white text-zinc-950 shadow-[0_8px_30px_rgb(0,0,0,0.08)] py-4 border border-zinc-200/50" 
                            : "bg-zinc-900 text-white shadow-xl py-5 border border-zinc-800"
                        }
                    `}
                >
                    {/* Logo */}
                    <Link to="/" className="flex items-center group relative z-50">
                        <img 
                            src={isScrolled ? "/logo.png" : "/logo-W.png"} 
                            alt="WUW Rentals Logo" 
                            className="h-10 md:h-12 w-auto object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]"
                        />
                    </Link>

                    {/* Desktop Navigation */}
                    <nav className="hidden md:flex items-center gap-2">
                        <Link 
                            to="#" 
                            className={`px-5 py-2.5 text-sm font-bold tracking-wide rounded-full transition-all duration-300 ${isScrolled ? 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 hover:shadow-md' : 'text-zinc-300 hover:text-white hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]'}`}
                        >
                            Executive 
                        </Link>
                        <Link 
                            to="#" 
                            className={`px-5 py-2.5 text-sm font-bold tracking-wide rounded-full transition-all duration-300 ${isScrolled ? 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 hover:shadow-md' : 'text-zinc-300 hover:text-white hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]'}`}
                        >
                            Sports
                        </Link>
                        <Link 
                            to="#" 
                            className={`px-5 py-2.5 text-sm font-bold tracking-wide rounded-full transition-all duration-300 ${isScrolled ? 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 hover:shadow-md' : 'text-zinc-300 hover:text-white hover:bg-zinc-800 hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]'}`}
                        >
                            Global Access
                        </Link>
                    </nav>

                    {/* Right Side Actions */}
                    <div className="hidden md:flex items-center gap-4">
                        {isAuthenticated ? (
                            <div className="flex items-center gap-3">
                                <Button
                                    onClick={() => navigate("/dashboard")}
                                    className={`rounded-full h-11 px-6 font-bold shadow-sm transition-all hover:scale-105 active:scale-95 ${
                                        isScrolled 
                                        ? 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200' 
                                        : 'bg-zinc-800 text-white hover:bg-zinc-700'
                                    }`}
                                >
                                    <LucideBookDashed className="size-4 mr-2" />
                                    Bookings
                                </Button>
                                <Button
                                    onClick={handleLogout}
                                    className="rounded-full h-11 px-6 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600 font-bold transition-all shadow-none"
                                >
                                    <LucideLogOut className="size-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <Link
                                    to="/auth/user/signin"
                                    className={`text-sm font-bold px-4 py-2 rounded-full transition-colors ${
                                        isScrolled 
                                        ? 'text-zinc-950 hover:bg-zinc-100' 
                                        : 'text-white hover:bg-zinc-800'
                                    }`}
                                >
                                    Sign in
                                </Link>
                                <Button
                                    onClick={() => navigate("/auth/user/signup")}
                                    className={`rounded-full h-11 px-6 font-bold shadow-md transition-all hover:scale-105 active:scale-95 ${
                                        isScrolled 
                                        ? 'bg-zinc-950 text-white hover:bg-zinc-800 hover:shadow-xl' 
                                        : 'bg-white text-zinc-950 hover:bg-zinc-100 hover:shadow-xl'
                                    }`}
                                >
                                    Start driving
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        className={`md:hidden flex items-center justify-center size-10 rounded-full transition-colors relative z-50 ${
                            mobileMenuOpen 
                                ? 'bg-zinc-100 text-zinc-900' 
                                : isScrolled 
                                    ? 'bg-zinc-100 text-zinc-900' 
                                    : 'bg-zinc-800 text-white'
                        }`}
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                    </button>
                </div>

                {/* Mobile Navigation Menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden absolute top-24 left-4 right-4 bg-white rounded-[2rem] shadow-2xl overflow-hidden p-6 border border-zinc-200 flex flex-col gap-2 origin-top animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-auto">
                        <div className="flex flex-col gap-1 pb-4 mb-4 border-b border-zinc-100">
                            <Link to="#" className="font-serif text-2xl font-bold py-3 text-zinc-900">Executive Fleet</Link>
                            <Link to="#" className="font-serif text-2xl font-bold py-3 text-zinc-900">Sports Vehicles</Link>
                            <Link to="#" className="font-serif text-2xl font-bold py-3 text-zinc-900">Global Access</Link>
                        </div>
                        
                        {isAuthenticated ? (
                            <div className="flex flex-col gap-3 pt-2">
                                <Button
                                    onClick={() => {
                                        navigate("/dashboard");
                                        setMobileMenuOpen(false);
                                    }}
                                    className="w-full rounded-2xl h-14 bg-zinc-950 text-white text-lg font-bold"
                                >
                                    Dashboard
                                </Button>
                                <Button
                                    onClick={handleLogout}
                                    className="w-full rounded-2xl h-14 bg-red-50 text-red-600 text-lg font-bold"
                                    variant="outline"
                                >
                                    Sign out
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 pt-2">
                                <Button
                                    onClick={() => navigate("/auth/user/signin")}
                                    className="w-full rounded-full h-14 bg-zinc-100 text-zinc-950 hover:bg-zinc-200 text-lg font-bold"
                                    variant="ghost"
                                >
                                    Sign in
                                </Button>
                                <Button
                                    onClick={() => navigate("/auth/user/signup")}
                                    className="w-full rounded-full h-14 bg-orange-500 text-white hover:bg-orange-600 text-lg font-bold shadow-lg shadow-orange-500/20"
                                >
                                    Start driving
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
};
