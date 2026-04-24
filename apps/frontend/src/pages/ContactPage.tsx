import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { MapPin, Phone, Clock, MessageCircle } from "lucide-react";

export const ContactPage = () => {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      <main className="flex-1 mt-24">
        {/* Hero */}
        <section className="bg-black text-white px-4 py-20 md:py-28 text-center">
          <p className="text-xs font-black tracking-[0.3em] text-zinc-500 uppercase mb-5">
            Get In Touch
          </p>
          <h1 className="text-4xl md:text-6xl font-serif font-black tracking-tight text-white mb-6 leading-[1.05]">
            Contact Us
          </h1>
          <p className="text-zinc-400 text-lg md:text-xl font-medium max-w-xl mx-auto leading-relaxed">
            We're here to help. Reach out for bookings, inquiries, or anything
            else.
          </p>
        </section>

        {/* Contact Cards + Map */}
        <section className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-20 md:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">

            {/* Left — contact details */}
            <div className="space-y-6">
              {/* Address */}
              <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 size-12 rounded-2xl bg-zinc-900 flex items-center justify-center">
                    <MapPin className="size-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase mb-2">
                      Location
                    </p>
                    <p className="text-zinc-900 font-semibold text-lg leading-snug">
                      No. 16, Anath Nagar 1st Stage,<br />Near Syndicate Circle
                    </p>
                    <p className="text-zinc-500 font-medium mt-1">
                      Manipal - 576104
                    </p>
                  </div>
                </div>
              </div>

              {/* Phone */}
              <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 size-12 rounded-2xl bg-zinc-900 flex items-center justify-center">
                    <Phone className="size-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase mb-2">
                      Phone
                    </p>
                    <a
                      href="tel:+918000800469"
                      className="block text-zinc-900 font-semibold text-lg hover:text-zinc-600 transition-colors"
                    >
                      +91 8000 800 469
                    </a>
                    <a
                      href="tel:+918000800468"
                      className="block text-zinc-500 font-medium mt-1 hover:text-zinc-700 transition-colors"
                    >
                      +91 8000 800 468
                    </a>
                  </div>
                </div>
              </div>

              {/* WhatsApp */}
              <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 size-12 rounded-2xl bg-[#25D366] flex items-center justify-center">
                    <MessageCircle className="size-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase mb-2">
                      WhatsApp
                    </p>
                    <p className="text-zinc-900 font-semibold text-lg">
                      Chat with us on WhatsApp
                    </p>
                    <a
                      href="https://wa.me/918000800469"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 px-5 py-2.5 rounded-full bg-[#25D366] text-white text-sm font-bold hover:bg-[#20bc5a] transition-colors duration-200"
                    >
                      Open WhatsApp
                    </a>
                  </div>
                </div>
              </div>

              {/* Hours */}
              <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 size-12 rounded-2xl bg-zinc-900 flex items-center justify-center">
                    <Clock className="size-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase mb-2">
                      Business Hours
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between gap-8 text-zinc-900 font-semibold">
                        <span>All Days of the Week</span>
                        <span>8:00 AM – 11:00 PM</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Google Maps embed */}
            <div className="rounded-[2rem] overflow-hidden border border-zinc-200 shadow-sm lg:sticky lg:top-28">
              <div className="bg-zinc-50 px-6 py-4 border-b border-zinc-200">
                <p className="text-[10px] font-black tracking-[0.2em] text-zinc-400 uppercase">
                  Find Us
                </p>
                <p className="text-zinc-900 font-semibold mt-0.5">
                  What U Want Rentals
                </p>
              </div>
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3715.2376795721666!2d74.78242847482501!3d13.347515306525745!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bbca5003436a3af%3A0xb7bf5d706dbd1639!2sWhat%20U%20Want%20Rentals!5e1!3m2!1sen!2sin!4v1776014905609!5m2!1sen!2sin"
                width="100%"
                height="480"
                style={{ border: 0, display: "block" }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="What U Want Rentals location"
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};
