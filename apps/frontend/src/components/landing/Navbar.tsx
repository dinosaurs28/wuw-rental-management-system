import { Link } from "react-router-dom";
import { Menu, X, Smartphone } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { openGetTheApp } from "@/lib/deepLink";

// Customers book and sign in only in the app (Nov 2026), so the website has no
// customer log in / register. Staff use /portal, which they already know.
const NAV_LINKS = [
  { name: "FAQs", to: "/faq" },
  { name: "Contact", to: "/contact" },
];

export const Navbar = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const getApp = () => {
    setMobileMenuOpen(false);
    openGetTheApp();
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
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="relative group px-4 py-2 text-sm font-bold text-gray-200 hover:text-white transition-colors uppercase tracking-wider"
            >
              {link.name}
              <span className="absolute bottom-0 left-1/2 w-0 h-[2px] bg-[#FF5F00] group-hover:w-full group-hover:left-0 transition-all duration-300 rounded-t-sm" />
            </Link>
          ))}
          <button
            type="button"
            onClick={getApp}
            className="ml-2 px-6 py-2.5 rounded-full flex items-center gap-2 text-sm font-bold text-white bg-[#FF5F00] hover:bg-[#E55500] hover:shadow-[0_0_15px_rgba(255,95,0,0.4)] transition-all duration-300 uppercase tracking-wider"
          >
            <Smartphone className="size-4" aria-hidden="true" />
            Get the app
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          type="button"
          className="md:hidden flex items-center justify-center p-2 text-white hover:bg-white/10 rounded-full transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
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
          <button
            type="button"
            onClick={getApp}
            className="flex items-center gap-3 px-6 py-4 text-left font-bold text-[#FF5F00] hover:bg-white/5 uppercase tracking-wider transition-colors"
          >
            <Smartphone className="size-5" aria-hidden="true" /> Get the app
          </button>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center gap-3 px-6 py-4 text-left font-bold text-white hover:bg-white/5 uppercase tracking-wider transition-colors pl-[3.25rem]"
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.name}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
};
