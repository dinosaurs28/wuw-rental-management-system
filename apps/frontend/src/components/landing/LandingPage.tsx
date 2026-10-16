import { Navbar } from "./Navbar";
import { SearchForm } from "./SearchForm";
import { Footer } from "./Footer";
import { HeroOfferSlider } from "./HeroOfferSlider";
import { StoreButtons } from "./StoreButtons";
import { Timer, CarFront, ClipboardCheck } from "lucide-react";
import { ADVANCE_BOOKING_DAYS, MAX_RENTAL_DAYS } from "@/utils/bookingPickers";

const FEATURES = [
  {
    icon: Timer,
    title: "12 hours or by the day",
    body: `Book 12 hours or 1–${MAX_RENTAL_DAYS} days, up to ${ADVANCE_BOOKING_DAYS} days ahead. The price you see includes GST and free kilometres.`,
  },
  {
    icon: CarFront,
    title: "Cars and two-wheelers",
    body: "Pick a four-wheeler or a bike, and filter for highway, hill-station or long-drive trips.",
  },
  {
    icon: ClipboardCheck,
    title: "Checked at pickup and return",
    body: "We photograph the vehicle and note fuel and kilometres when you collect and return it, so your bill is easy to check.",
  },
];

export const LandingPage = () => {
  return (
    <div className="relative min-h-screen font-sans bg-white selection:bg-[#FF5F00] selection:text-white">
      {/* Navbar overlaying the hero */}
      <div className="absolute top-0 w-full z-50">
        <Navbar />
      </div>

      <main className="w-full">
        {/* Hero: live offer posters as a slider (#15); the static image when there are none */}
        <HeroOfferSlider
          fallback={
            <section className="relative w-full h-[65vh] min-h-[500px]">
              {/* Hero Background Image - Sixt style car */}
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat bg-[#2C2F33]"
                style={{
                  backgroundImage: 'url("https://images.unsplash.com/photo-1555215695-3004980ad54e?q=80&w=3000&auto=format&fit=crop")',
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
            </section>
          }
        />

        {/* Huge Orange Banner. The search form is the first child here, pulled up
            over the hero with a negative margin so it stays in normal flow — its
            real (variable) height then pushes the heading down on every screen,
            instead of overlapping it. */}
        <section className="bg-[#FF5F00] pb-16 px-4 text-center">
            {/* Floating Search Form Widget */}
            <div className="relative z-20 -mt-32 sm:-mt-36 md:-mt-40 mb-12 md:mb-20 px-0 sm:px-2 md:px-6 lg:px-12 flex justify-center">
               <div className="w-full max-w-[1300px]">
                  <SearchForm />
               </div>
            </div>

            <h2 className="text-[2.5rem] md:text-[4rem] lg:text-[5rem] font-black text-[#1A1A1A] uppercase tracking-tighter leading-none mb-4 md:mb-6">
                EXCLUSIVE RATES FOR MEMBERS
            </h2>
            <p className="text-lg md:text-xl lg:text-2xl font-bold text-[#1A1A1A]">
                Experience luxury vehicles at prices you'll love.
            </p>
        </section>

        {/* What renting with us is like — real service facts only */}
        <section className="bg-white py-12 md:py-20 px-4 md:px-6 lg:px-8">
            <ul className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-y-8 md:gap-x-12">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                    <li key={title} className="flex md:flex-col gap-4 text-left">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFF1E8] text-[#FF5F00]">
                            <Icon className="size-6" strokeWidth={2} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="text-lg md:text-xl font-bold tracking-tight text-[#1A1A1A]">{title}</h3>
                            <p className="mt-1.5 max-w-[36ch] text-[15px] md:text-base leading-relaxed text-zinc-600">{body}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </section>

        {/* Mobile app */}
        <section className="px-4 md:px-6 lg:px-8 pb-16">
            <div className="max-w-[1200px] mx-auto rounded-3xl bg-[#F4F4F4] p-6 md:p-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-8">
                <div>
                    <h2 className="text-2xl md:text-4xl font-black text-[#1A1A1A] uppercase tracking-tighter leading-none mb-3">
                        Get the WUW Rentals app
                    </h2>
                    <p className="text-gray-600 font-medium max-w-xl">
                        Book, extend and keep track of your rentals from your phone.
                    </p>
                </div>
                <StoreButtons tone="light" className="shrink-0" />
            </div>
        </section>

        {/* Bottom Banner */}
        <section className="px-4 md:px-6 lg:px-8 pb-8 md:pb-12">
            <div 
                className="max-w-[1200px] mx-auto rounded-3xl overflow-hidden relative min-h-[400px] md:min-h-[500px] flex items-end p-8 md:p-12 lg:p-16 bg-cover bg-center"
                style={{
                    backgroundImage: 'url("https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=3000&auto=format&fit=crop")'
                }}
            >
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="relative z-10 w-full">
                    <div className="inline-block border-2 border-white px-6 py-4 mb-8 skew-x-[-12deg] bg-black/20 backdrop-blur-sm">
                        <div className="text-white text-center uppercase skew-x-[12deg]">
                            <p className="text-xs md:text-sm font-bold tracking-[0.2em] mb-1">UP TO</p>
                            <p className="text-4xl md:text-6xl font-black leading-none mb-1 tracking-tighter">15%</p>
                            <p className="text-xl md:text-3xl font-black tracking-tight">OFF</p>
                        </div>
                    </div>
                    <h2 className="text-3xl md:text-5xl lg:text-[4rem] font-black text-white uppercase tracking-tighter leading-none w-full">
                        WUW REWARDS: ELEVATE YOUR JOURNEY
                    </h2>
                </div>
            </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};


