import { Link, useNavigate } from "react-router-dom";
import { Menu, X, User as UserIcon, LogOut, LayoutDashboard } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/lib/utils";

export const Navbar = () => {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/");
    setMobileMenuOpen(false);
  };

  return (
    <header 
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-white/5",
        scrolled ? "bg-black/90 backdrop-blur-xl shadow-2xl py-0" : "bg-gradient-to-b from-black/80 to-transparent py-2"
      )}
    >
      <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 lg:px-12 h-20 flex items-center justify-between">
        
        {/* Left Side: Logo */}
        <Link to="/" className="flex items-center flex-shrink-0 group">
          <img
            src="/logo-W.png"
            alt="WUW Rentals Logo"
            className="h-8 md:h-10 w-auto object-contain group-hover:scale-105 transition-transform duration-300"
          />
        </Link>

        {/* Right Side: Actions (Desktop) */}
        <div className="hidden md:flex items-center gap-2 lg:gap-4">

          {isAuthenticated ? (
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/dashboard")}
                className="relative group px-4 py-2 flex items-center gap-2 text-sm font-bold text-gray-200 hover:text-white transition-colors uppercase tracking-wider"
              >
                <LayoutDashboard className="size-4 opacity-70 group-hover:opacity-100" />
                Manage Bookings
                <span className="absolute bottom-0 left-1/2 w-0 h-[2px] bg-[#FF5F00] group-hover:w-full group-hover:left-0 transition-all duration-300 rounded-t-sm" />
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-2.5 rounded-full flex items-center gap-2 text-sm font-bold text-white bg-white/10 hover:bg-white/20 hover:text-[#FF5F00] transition-all duration-300 uppercase tracking-wider"
              >
                <LogOut className="size-4" /> Log out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-4 pl-2">
              <Link
                to="/auth/user/signin"
                className="relative group px-4 py-2 flex items-center gap-2 text-sm font-bold text-gray-200 hover:text-white transition-colors uppercase tracking-wider"
              >
                <UserIcon className="size-5 opacity-70 group-hover:opacity-100" />
                Log in
                <span className="absolute bottom-0 left-1/2 w-0 h-[2px] bg-[#FF5F00] group-hover:w-full group-hover:left-0 transition-all duration-300 rounded-t-sm" />
              </Link>
              <Link
                to="/auth/user/signup"
                className="px-6 py-2.5 rounded-full text-sm font-bold text-white bg-[#FF5F00] hover:bg-[#E55500] hover:shadow-[0_0_15px_rgba(255,95,0,0.4)] transition-all duration-300 uppercase tracking-wider"
              >
                Register
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden flex items-center justify-center p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {/* Mobile Navigation Menu */}
      <div 
        className={cn(
            "md:hidden absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-white/10 flex flex-col pointer-events-auto transition-all duration-300 overflow-hidden",
            mobileMenuOpen ? "max-h-[500px] opacity-100 py-2" : "max-h-0 opacity-0 py-0"
        )}
      >
        <div className="flex flex-col">
          {isAuthenticated ? (
            <>
              <button
                onClick={() => {
                  navigate("/dashboard");
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-3 px-6 py-4 text-left font-bold text-white hover:bg-white/5 uppercase tracking-wider transition-colors"
              >
                <LayoutDashboard className="size-5" /> Manage Bookings
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-6 py-4 text-left font-bold text-[#FF5F00] hover:bg-white/5 transition-colors uppercase tracking-wider"
              >
                <LogOut className="size-5" /> Log out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/auth/user/signin"
                className="flex items-center gap-3 px-6 py-4 text-left font-bold text-white hover:bg-white/5 uppercase tracking-wider transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                <UserIcon className="size-5" /> Log in
              </Link>
              <Link
                to="/auth/user/signup"
                className="flex items-center gap-3 px-6 py-4 text-left font-bold text-[#FF5F00] hover:bg-white/5 transition-colors uppercase tracking-wider pl-[3.25rem]"
                onClick={() => setMobileMenuOpen(false)}
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
