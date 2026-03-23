import { Link } from "react-router-dom";
import { Twitter, Instagram, Linkedin, Mail } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="bg-zinc-950 text-zinc-400 font-sans mt-24">
      {/* Main Footer Container with inner rounded card for the interlocking look */}
      <div className="container mx-auto px-4 md:px-6 lg:px-8 pb-6">
        <div className="bg-zinc-900/50 rounded-[3rem] p-8 md:p-12 lg:p-16 border border-zinc-800/50">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 lg:gap-8">
            {/* Brand & Newsletter Column */}
            <div className="md:col-span-12 lg:col-span-5 flex flex-col items-center md:items-start text-center md:text-left">
              <Link to="/" className="flex items-center group mb-6">
                <img
                  src="/logo-W.png"
                  alt="WUW Rentals Logo"
                  className="h-10 md:h-12 w-auto object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] grayscale hover:grayscale-0"
                />
              </Link>
              <p className="text-zinc-400 max-w-sm leading-relaxed mb-8">
                Redefining mobility with a premium fleet and exceptional
                service. Drive the extraordinary.
              </p>

              {/* Newsletter */}
              <div className="w-full max-w-md mx-auto md:mx-0">
                <h4 className="text-xs font-bold text-zinc-500 mb-4 tracking-[0.2em] uppercase">
                  Private Access
                </h4>
                <div className="relative group/input flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-5 pointer-events-none text-zinc-500 group-focus-within/input:text-orange-500 transition-colors">
                      <Mail className="size-5" />
                    </div>
                    <input
                      type="email"
                      placeholder="Enter your email"
                      className="w-full h-14 bg-zinc-950/50 border border-zinc-800 text-white rounded-full pl-14 pr-6 focus:outline-none focus:border-orange-500 focus:bg-zinc-900 transition-all placeholder:text-zinc-600"
                    />
                  </div>
                  <button className="h-14 px-8 bg-zinc-100 hover:bg-white text-zinc-950 font-bold rounded-full flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 w-full sm:w-auto shrink-0">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>

            {/* Spacer for large screens */}
            <div className="hidden lg:block lg:col-span-1"></div>

            {/* Fleet Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-sm font-bold text-white mb-6 tracking-widest uppercase">
                The Fleet
              </h4>
              <ul className="space-y-4">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Executive Sedans
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Luxury SUVs
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Sports Cars
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Electric
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-sm font-bold text-white mb-6 tracking-widest uppercase">
                Company
              </h4>
              <ul className="space-y-4">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    About Us
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Locations
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Careers
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Press
                  </Link>
                </li>
              </ul>
            </div>

            {/* Support Links */}
            <div className="md:col-span-4 lg:col-span-2 text-center md:text-left">
              <h4 className="text-sm font-bold text-white mb-6 tracking-widest uppercase">
                Support
              </h4>
              <ul className="space-y-4">
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Help Center
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Concierge
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Terms
                  </Link>
                </li>
                <li>
                  <Link
                    to="#"
                    className="text-zinc-500 font-medium hover:text-white hover:translate-x-1 inline-flex transition-all"
                  >
                    Privacy
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-16 pt-8 border-t border-zinc-800/50 flex flex-col-reverse md:flex-row justify-between items-center gap-6">
            <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4 text-sm text-zinc-600 font-medium text-center md:text-left">
              <p>© {new Date().getFullYear()} WUW Rentals Inc.</p>
              <span className="hidden md:inline text-zinc-800">•</span>
              <p>Designed for excellence.</p>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-3">
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 hover:bg-white hover:text-zinc-950 hover:border-white transition-all transform hover:scale-105"
              >
                <Twitter className="size-4" />
              </a>
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 hover:bg-white hover:text-zinc-950 hover:border-white transition-all transform hover:scale-105"
              >
                <Instagram className="size-4" />
              </a>
              <a
                href="#"
                className="size-12 flex items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 hover:bg-white hover:text-zinc-950 hover:border-white transition-all transform hover:scale-105"
              >
                <Linkedin className="size-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
