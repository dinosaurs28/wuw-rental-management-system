import { Navbar } from "./Navbar";
import { SearchForm } from "./SearchForm";
import { Footer } from "./Footer";
import { Check, Car, HeartHandshake } from "lucide-react";

export const LandingPage = () => {
  return (
    <div className="relative min-h-screen font-sans bg-white selection:bg-[#FF5F00] selection:text-white">
      {/* Navbar overlaying the hero */}
      <div className="absolute top-0 w-full z-50">
        <Navbar />
      </div>

      <main className="w-full">
        {/* Hero Section (Just image and widget) */}
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

        {/* Features Section */}
        <section className="bg-white py-16 md:py-24 px-4 md:px-6 lg:px-8">
            <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16">
                {/* Feature 1 */}
                <div className="flex flex-col text-left">
                    <div className="flex items-center gap-3 mb-4">
                        <Check className="size-6 md:size-7 text-[#1A1A1A]" strokeWidth={3} />
                        <h3 className="text-base md:text-lg font-bold text-[#1A1A1A]">Unmatched Value</h3>
                    </div>
                    <p className="text-2xl md:text-[1.75rem] leading-tight font-black text-[#1A1A1A] tracking-tight">
                        Experience luxury without the premium price tag
                    </p>
                </div>
                {/* Feature 2 */}
                <div className="flex flex-col text-left">
                    <div className="flex items-center gap-3 mb-4">
                        <Car className="size-6 md:size-7 text-[#1A1A1A]" strokeWidth={3} />
                        <h3 className="text-base md:text-lg font-bold text-[#1A1A1A]">Curated Fleet</h3>
                    </div>
                    <p className="text-2xl md:text-[1.75rem] leading-tight font-black text-[#1A1A1A] tracking-tight">
                        From executive sedans to exotic supercars
                    </p>
                </div>
                {/* Feature 3 */}
                <div className="flex flex-col text-left">
                    <div className="flex items-center gap-3 mb-4">
                        <HeartHandshake className="size-6 md:size-7 text-[#1A1A1A]" strokeWidth={3} />
                        <h3 className="text-base md:text-lg font-bold text-[#1A1A1A]">White-Glove Service</h3>
                    </div>
                    <p className="text-2xl md:text-[1.75rem] leading-tight font-black text-[#1A1A1A] tracking-tight">
                        Seamless experience from booking to return
                    </p>
                </div>
            </div>
        </section>

        {/* Bottom Banner */}
        <section className="px-4 md:px-6 lg:px-8 pb-24">
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


