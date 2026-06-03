import { Link } from "react-router-dom";
import { Twitter, Instagram, Linkedin, Facebook, Youtube, ArrowRight } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="bg-black text-white font-sans pt-20 pb-8 relative overflow-hidden mt-20">
      {/* Background glow or subtle gradient */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      
      <div className="w-full px-4 md:px-6 lg:px-12 mx-auto max-w-[1600px] relative z-10">
        
        {/* Top Section with Newsletter */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-10 mb-20 bg-[#1A1A1A] p-8 md:p-12 rounded-3xl border border-white/5">
            <div>
                <h3 className="text-3xl font-black mb-2 uppercase tracking-tight text-white">Stay ahead of the curve</h3>
                <p className="text-gray-400 font-medium max-w-xl">Subscribe for exclusive WUW Rewards, early access to new fleet arrivals, and special seasonal offers.</p>
            </div>
            <div className="flex w-full lg:w-auto items-center min-w-[320px] bg-black border border-white/10 rounded-full overflow-hidden p-1 focus-within:border-[#FF5F00] transition-colors">
                <input 
                    type="email" 
                    placeholder="Enter your email" 
                    className="bg-transparent text-white px-6 py-3 w-full outline-none placeholder:text-gray-500 font-medium text-sm"
                />
                <button className="bg-[#FF5F00] hover:bg-[#E55500] p-3 rounded-full text-white transition-colors">
                    <ArrowRight className="size-5" />
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-16 mb-20">
          
          {/* Column 1: Brand */}
          <div className="lg:col-span-2 flex flex-col items-start text-left">
            <Link to="/" className="flex items-center mb-8 group">
              <img
                src="/logo-W.png"
                alt="WUW Rentals Logo"
                className="h-10 w-auto object-contain group-hover:scale-105 transition-transform duration-300"
              />
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed max-w-sm font-medium">
              Redefining mobility with a premium fleet and exceptional service. Drive the extraordinary with WUW Rentals and experience the journey you deserve.
            </p>
          </div>

          {/* Column: Support & Company */}
          <div className="flex flex-col text-left">
            <h4 className="text-sm font-black text-white mb-6 uppercase tracking-widest">
              Company
            </h4>
            <ul className="space-y-4">
              {[
                  { name: 'FAQs', path: '/faq' },
                  { name: 'Contact Us', path: '/contact' },
                  { name: 'Terms & Conditions', path: '/legal/terms.html' },
                  { name: 'Privacy Policy', path: '/legal/privacy.html' },
                  { name: 'Refund Policy', path: '/refund-policy' }
              ].map(link => (
                <li key={link.name}>
                    <Link to={link.path} className="group flex items-center gap-2 text-sm text-gray-400 font-medium hover:text-white transition-colors">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5F00] opacity-0 group-hover:opacity-100 transition-opacity" />
                        {link.name}
                    </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col-reverse md:flex-row justify-between items-center gap-6 relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          
          <div className="text-sm text-gray-500 font-medium text-center md:text-left">
            <p>© {new Date().getFullYear()} WUW Rentals Inc. All rights reserved.</p>
          </div>

          {/* Social Links */}
          <div className="flex items-center gap-3">
            {[Facebook, Twitter, Instagram, Youtube, Linkedin].map((Icon, idx) => (
                <a key={idx} href="#" className="flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-[#FF5F00] hover:-translate-y-1 text-gray-400 hover:text-white transition-all duration-300">
                  <Icon className="size-4" />
                </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};
