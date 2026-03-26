import { Navbar } from "./Navbar";
import { SearchForm } from "./SearchForm";

import { motion } from "motion/react";
import { Car, Headphones, Star, ArrowRight } from "lucide-react";
import { Footer } from "./Footer";
import { Link } from "react-router-dom";

export const LandingPage = () => {
  return (
    <div className="relative min-h-screen font-sans selection:bg-orange-500/30 bg-white">
      {/* Global Fixed Background Car Image */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-10"
        style={{
          backgroundImage:
            'url("https://images.unsplash.com/photo-1614200187524-dc4b892acf16?q=80&w=3000&auto=format&fit=crop")',
        }}
      />
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-white/50 via-white/80 to-white" />

      {/* Main Content Wrapper */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <main className="flex-1 w-full max-w-[1600px] mx-auto overflow-hidden">
          {/* Interlocking Layout Wrapper */}
          <div className="relative pt-32 px-4 md:px-6 lg:px-8 pb-32">
            {/* Hero Massive Card */}
            <div className="relative rounded-[3rem] md:rounded-[4rem] overflow-hidden bg-zinc-900 min-h-[85vh] flex flex-col items-center pt-24 pb-48 px-6 md:px-16 text-center shadow-2xl z-10 border border-zinc-800">
              {/* Background subtle gradient / effect */}
              <motion.div
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-50"
                style={{
                  backgroundImage:
                    'url("https://images.unsplash.com/photo-1542282088-fe8426682b8f?q=80&w=2787&auto=format&fit=crop")',
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/30 via-zinc-950/70 to-zinc-950 z-0" />

              <div className="relative z-10 flex flex-col items-center justify-center flex-1 w-full max-w-6xl mx-auto">
                <motion.h1
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.8,
                    delay: 0.1,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="font-serif text-6xl md:text-8xl lg:text-[7rem] leading-[0.9] text-zinc-50 max-w-5xl tracking-tight"
                >
                  Epic journeys <br className="hidden md:block" />
                  built around{" "}
                  <span className="text-orange-500 italic pr-4">you.</span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.8,
                    delay: 0.2,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="mt-10 text-xl font-medium text-zinc-400 max-w-2xl leading-relaxed"
                >
                  Uncompromising luxury, meticulously curated. Experience the
                  road like never before with our premium selection of exotic
                  and executive vehicles.
                </motion.p>
              </div>
            </div>

            {/* Overlapping Content Box (White Section directly hugging the dark hero) */}
            <div className="relative z-20 w-[95%] mx-auto -mt-32 md:-mt-40 pt-16 md:pt-24 pb-24 px-6 md:px-16 rounded-[3rem] md:rounded-[4rem] bg-zinc-50 shadow-[0_-20px_40px_-15px_rgba(0,0,0,0.3)] border border-zinc-200/50">
              {/* Search Module nested inside the white block */}
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.8,
                  delay: 0.4,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="-mt-32 md:-mt-48 mb-20 md:mb-32 max-w-5xl mx-auto"
              >
                <SearchForm />
              </motion.div>

              {/* Features Header */}
              <div className="flex flex-col md:flex-row items-end justify-between mb-16 md:mb-24 gap-8 max-w-6xl mx-auto">
                <div className="max-w-3xl">
                  <h2 className="font-serif text-5xl md:text-7xl text-zinc-950 mb-6 tracking-tight leading-[0.95]">
                    The new standard <br />
                    of{" "}
                    <span className="text-orange-500 italic pr-2">
                      excellence.
                    </span>
                  </h2>
                  <p className="text-xl text-zinc-600 leading-relaxed font-medium">
                    We don't just rent cars. We deliver an impeccable experience
                    seamlessly crafted for those who demand the absolute best.
                  </p>
                </div>
                <Link
                  to="#"
                  className="group hidden md:flex items-center gap-2 text-zinc-900 font-bold text-lg hover:text-orange-600 transition-colors pb-4"
                >
                  Explore Our Fleet
                  <ArrowRight className="size-6 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>

              {/* Staggered Grid Layout for Features */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 max-w-6xl mx-auto">
                {/* Feature 2 - Now spans 12 columns as the primary feature */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
                  className="md:col-span-12 group flex flex-col md:flex-row items-center gap-10 bg-zinc-900 rounded-[3rem] p-10 lg:p-16 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8">
                    <Star className="size-8 text-orange-500 fill-orange-500/20" />
                  </div>
                  <div className="size-24 shrink-0 rounded-[2rem] bg-zinc-800 flex items-center justify-center text-white shadow-lg border border-zinc-700/50 group-hover:scale-105 group-hover:bg-orange-500 group-hover:border-orange-400 group-hover:shadow-orange-500/20 transition-all duration-300 relative z-10">
                    <Car className="size-12" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 relative z-10 text-center md:text-left">
                    <h3 className="font-serif text-4xl lg:text-5xl mb-6 text-white tracking-tight">
                      Pristine Fleet.
                    </h3>
                    <p className="text-xl text-zinc-400 leading-relaxed font-medium max-w-3xl">
                      From Porsche to Mercedes-AMG. Every vehicle is deep-cleaned
                      and meticulously inspected before the keys touch your hands.
                    </p>
                  </div>
                </motion.div>

                {/* Feature 3 - Spans 12 columns (Full width banner style) */}
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
                  className="md:col-span-12 group flex flex-col md:flex-row items-center gap-10 bg-orange-500 rounded-[3rem] p-10 lg:p-16 shadow-lg shadow-orange-500/20 mt-4 overflow-hidden relative"
                >
                  <div className="absolute top-20 right-20 size-[30rem] rounded-full bg-white/10 blur-3xl" />

                  <div className="size-24 shrink-0 rounded-[2rem] bg-white flex items-center justify-center text-orange-600 shadow-xl group-hover:scale-105 transition-all duration-300 relative z-10">
                    <Headphones className="size-12" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 relative z-10 text-center md:text-left">
                    <h3 className="font-serif text-4xl lg:text-5xl font-bold text-white mb-4 tracking-tight">
                      White-Glove Support.
                    </h3>
                    <p className="text-xl text-orange-100 leading-relaxed font-medium max-w-3xl">
                      A dedicated concierge team available 24/7. We anticipate
                      your needs so you can focus entirely on the drive.
                    </p>
                  </div>
                  <div className="relative z-10 mt-6 md:mt-0">
                    <Link
                      to="#"
                      className="px-8 py-5 bg-white text-orange-600 rounded-full font-bold text-lg hover:bg-zinc-950 hover:text-white transition-colors flex items-center gap-2"
                    >
                      Contact Concierge
                    </Link>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
};
