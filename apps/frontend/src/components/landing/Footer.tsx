import { Link } from "react-router-dom";
import { MapPin, Phone, MessageCircle } from "lucide-react";
import { StoreButtons } from "./StoreButtons";
import { BUSINESS_NAME, CONTACT_ADDRESS, CONTACT_PHONES, WHATSAPP_URL } from "@/lib/contact";

type FooterLink = { name: string; to: string; external?: boolean };

// Static policy pages live under /legal as plain HTML, so they're ordinary links
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Explore",
    links: [
      { name: "Browse vehicles", to: "/vehicles" },
      { name: "FAQs", to: "/faq" },
      { name: "Contact us", to: "/contact" },
    ],
  },
  {
    title: "Policies",
    links: [
      { name: "Refund policy", to: "/refund-policy" },
      { name: "Terms & conditions", to: "/legal/terms.html", external: true },
      { name: "Privacy policy", to: "/legal/privacy.html", external: true },
    ],
  },
];

const linkClass =
  "text-[15px] text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:text-white focus-visible:underline";

export const Footer = () => {
  const primaryPhone = CONTACT_PHONES[0];

  return (
    <footer className="relative mt-20 flow-root bg-black font-sans text-white md:mt-28">
      <div className="mx-auto w-full max-w-[1300px] px-4 md:px-6 lg:px-12">
        {/* Help with a booking — the one call to action down here */}
        <div className="relative z-10 -mt-16 rounded-3xl bg-[#FF5F00] p-6 text-[#1A1A1A] md:-mt-20 md:p-10">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-8">
            <div>
              <h2 className="text-2xl font-black uppercase leading-none tracking-tighter md:text-4xl">
                Need help with a booking?
              </h2>
              <p className="mt-2 max-w-xl font-semibold text-balance text-[#1A1A1A]/80">
                Call or WhatsApp the Manipal branch and we&apos;ll help you pick a vehicle and dates.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={primaryPhone.href}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#1A1A1A] px-5 font-semibold text-white transition-colors hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#FF5F00]"
              >
                <Phone className="size-[18px]" aria-hidden="true" />
                Call {primaryPhone.display}
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 font-semibold text-[#1A1A1A] transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#FF5F00]"
              >
                <MessageCircle className="size-[18px] text-[#1FAF55]" aria-hidden="true" />
                WhatsApp us
              </a>
            </div>
          </div>
        </div>

        {/* Brand + links + visit us */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 pt-12 pb-12 md:grid-cols-12 md:pt-16 md:pb-16">
          <div className="col-span-2 md:col-span-4">
            <Link to="/" className="inline-flex" aria-label={`${BUSINESS_NAME} home`}>
              <img src="/logo-W.png" alt="WUW Rentals" className="h-9 w-auto object-contain" />
            </Link>
            <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-zinc-400">
              Car and bike rentals in Manipal. Book 12 hours or by the day, online or in the app.
            </p>
            <StoreButtons tone="dark" className="mt-6" />
          </div>

          {COLUMNS.map((column) => (
            <nav
              key={column.title}
              aria-label={column.title}
              className="col-span-1 md:col-span-2"
            >
              <h3 className="text-sm font-semibold text-white">{column.title}</h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.name}>
                    {link.external ? (
                      <a href={link.to} className={linkClass}>
                        {link.name}
                      </a>
                    ) : (
                      <Link to={link.to} className={linkClass}>
                        {link.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <address className="col-span-2 not-italic md:col-span-4 lg:col-span-3 lg:col-start-10">
            <h3 className="text-sm font-semibold text-white">Visit us</h3>
            <p className="mt-4 flex gap-2 text-[15px] leading-relaxed text-zinc-400">
              <MapPin className="mt-1 size-4 shrink-0 text-[#FF5F00]" aria-hidden="true" />
              <span>
                {CONTACT_ADDRESS.lines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
                <span className="block">{CONTACT_ADDRESS.cityPin}</span>
              </span>
            </p>
            <ul className="mt-4 space-y-2">
              {CONTACT_PHONES.map((phone) => (
                <li key={phone.href}>
                  <a href={phone.href} className={`${linkClass} inline-flex items-center gap-2`}>
                    <Phone className="size-4 shrink-0 text-[#FF5F00]" aria-hidden="true" />
                    {phone.display}
                  </a>
                </li>
              ))}
            </ul>
          </address>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 py-6 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {BUSINESS_NAME}
          </p>
          <p>Manipal, Karnataka</p>
        </div>
      </div>
    </footer>
  );
};
