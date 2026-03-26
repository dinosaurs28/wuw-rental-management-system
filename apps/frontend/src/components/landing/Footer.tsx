import { Link } from "react-router-dom";
import { Twitter, Instagram, Linkedin, Mail } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="bg-black text-zinc-400 font-sans pt-24 pb-12 relative z-20">
      {/* Main Footer Container with inner rounded card for the interlocking look */}
      <div className="container mx-auto px-4 md:px-6 lg:px-8 pb-12">
        <div className="bg-white rounded-[3rem] p-10 md:p-14 lg:p-20 shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-zinc-100">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-16 lg:gap-12">
            {/* Brand & Newsletter Column */}
            <div className="md:col-span-12 lg:col-span-5 flex flex-col items-center md:items-start text-center md:text-left">
              <Link to="/" className="flex items-center group mb-8">
                <img
                  src="/logo-W.png"
                  alt="WUW Rentals Logo"
                  className="h-10 md:h-12 w-auto object-contain group-hover:scale-105 transition-transform duration-500"
                />
              </Link>
              <p className="text-zinc-500 max-w-sm text-lg leading-relaxed mb-10 font-medium">
                Redefining mobility with a premium fleet and exceptional
                service. Drive the extraordinary.
              </p>

              {/* Newsletter */}
              <div className="w-full max-w-md mx-auto md:mx-0">
                <h4 className="text-xs font-bold text-zinc-400 mb-5 tracking-[0.25em] uppercase">
                  Private Access
                </h4>
                <div className="relative group/input flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-6 pointer-events-none text-zinc-400 group-focus-within/input:text-zinc-900 transition-colors">
                      <Mail className="size-5" />
                    </div>
                    <input
                      type="email"
                      placeholder="Enter your email"
                      className="w-full h-16 bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-2xl pl-16 pr-6 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 focus:border-zinc-900 transition-all placeholder:text-zinc-400 text-base"
                    />
                  </div>
                  <button className="h-16 px-10 bg-zinc-900 hover:bg-black text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-95 w-full sm:w-auto shrink-0">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>

            {/* Spacer for large screens */}
            <div className="hidden lg:block lg:col-span-1"></div>

            {/* Fleet Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-xs font-black text-zinc-900 mb-8 tracking-[0.2em] uppercase">
                The Fleet
              </h4>
              <ul className="space-y-5">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Luxury SUVs
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Electric
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-xs font-black text-zinc-900 mb-8 tracking-[0.2em] uppercase">
                Company
              </h4>
              <ul className="space-y-5">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    About Us
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Locations
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Careers
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Press
                  </Link>
                </li>
              </ul>
            </div>

            {/* Support Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-xs font-black text-zinc-900 mb-8 tracking-[0.2em] uppercase">
                Support
              </h4>
              <ul className="space-y-5">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Help Center
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Concierge
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Terms
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-semibold hover:text-zinc-900 hover:translate-x-1 inline-flex transition-all duration-300"
                  >
                    Privacy
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-20 pt-10 border-t border-zinc-100 flex flex-col-reverse md:flex-row justify-between items-center gap-8">
            <div className="flex flex-col md:flex-row items-center gap-3 md:gap-6 text-sm text-zinc-400 font-semibold text-center md:text-left">
              <p>© {new Date().getFullYear()} WUW Rentals Inc.</p>
              <span className="hidden md:inline text-zinc-200">•</span>
              <p>Designed for excellence.</p>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-4">
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-2xl bg-zinc-50 border border-zinc-100 text-zinc-400 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all duration-300 transform hover:-translate-y-1"
              >
                <Twitter className="size-5" />
              </a>
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-2xl bg-zinc-50 border border-zinc-100 text-zinc-400 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all duration-300 transform hover:-translate-y-1"
              >
                <Instagram className="size-5" />
              </a>
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-2xl bg-zinc-50 border border-zinc-100 text-zinc-400 hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-all duration-300 transform hover:-translate-y-1"
              >
                <Linkedin className="size-5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
