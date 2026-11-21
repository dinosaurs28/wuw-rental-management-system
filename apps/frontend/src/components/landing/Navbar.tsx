import { Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Nov 21 2026: the website is staff-only — customers book in the app. The
// header keeps the logo and a way into the staff / manager / admin portal.
export const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-white/5",
        scrolled ? "bg-black/90 backdrop-blur-xl shadow-2xl py-0" : "bg-gradient-to-b from-black/80 to-transparent py-2",
      )}
    >
      <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 lg:px-12 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center flex-shrink-0 group">
          <img
            src="/logo-W.png"
            alt="WUW Rentals Logo"
            className="h-8 md:h-10 w-auto object-contain group-hover:scale-105 transition-transform duration-300"
          />
        </Link>
        <Link
          to="/"
          className="px-5 py-2.5 rounded-full flex items-center gap-2 text-sm font-bold text-white bg-white/10 hover:bg-white/20 transition-all duration-300 uppercase tracking-wider"
        >
          <LogIn className="size-4" /> Staff login
        </Link>
      </div>
    </header>
  );
};
