import { Navbar } from "./Navbar";
import { SearchForm } from "./SearchForm";

import { motion } from "motion/react";
import { Globe, Car, Headphones } from "lucide-react";
import { Footer } from "./Footer";

export const LandingPage = () => {
    return (
        <div className="min-h-screen flex flex-col bg-white">
            <Navbar />

            <main className="flex-1">
                {/* Hero Section */}
                <section className="relative min-h-[560px] md:min-h-[600px] w-full overflow-hidden bg-zinc-950">
                    {/* Background Image */}
                    <div
                        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                        style={{
                            backgroundImage: 'url("https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=2694&auto=format&fit=crop")',
                        }}
                    />
                    {/* Dark Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/70 to-zinc-950/40" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />

                    {/* Hero Content */}
                    <div className="relative z-10 container mx-auto px-4 lg:px-8 pt-16 md:pt-24 pb-32 md:pb-40">
                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className="max-w-2xl"
                        >
                            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
                                Premium mobility.
                                <br />
                                <span className="text-orange-500">Anywhere, anytime.</span>
                            </h1>
                            <motion.p
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
                                className="mt-5 text-base sm:text-lg text-zinc-300 max-w-lg leading-relaxed"
                            >
                                Experience the difference with our luxury fleet. From executive sedans to spacious SUVs, find your perfect drive.
                            </motion.p>
                        </motion.div>
                    </div>
                </section>

                {/* Search Form - Overlapping Hero */}
                <div className="relative z-20 container mx-auto px-4 lg:px-8 -mt-20 md:-mt-16 mb-16 md:mb-20">
                    <motion.div
                        initial={{ opacity: 0, y: 32 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
                    >
                        <SearchForm />
                    </motion.div>
                </div>

                {/* Features Section */}
                <section className="py-16 md:py-20 bg-white">
                    <div className="container mx-auto px-4 lg:px-8">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
                            {/* Feature 1 */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5 }}
                                className="flex flex-col items-start"
                            >
                                <div className="size-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600 mb-5">
                                    <Globe className="size-6" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-900 mb-2">Global Reach</h3>
                                <p className="text-sm text-zinc-600 leading-relaxed">
                                    Access premium mobility at over 2,000+ locations worldwide. From airports to city centers, we're where you need us.
                                </p>
                            </motion.div>

                            {/* Feature 2 */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: 0.1 }}
                                className="flex flex-col items-start"
                            >
                                <div className="size-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600 mb-5">
                                    <Car className="size-6" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-900 mb-2">Premium Fleet</h3>
                                <p className="text-sm text-zinc-600 leading-relaxed">
                                    Drive the latest models from top brands like BMW, Mercedes-Benz, and Audi. Experience luxury in every mile.
                                </p>
                            </motion.div>

                            {/* Feature 3 */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: 0.2 }}
                                className="flex flex-col items-start"
                            >
                                <div className="size-12 rounded-2xl bg-orange-100 flex items-center justify-center text-orange-600 mb-5">
                                    <Headphones className="size-6" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-900 mb-2">Exceptional Service</h3>
                                <p className="text-sm text-zinc-600 leading-relaxed">
                                    Enjoy 24/7 dedicated customer support and a seamless rental experience tailored to your specific needs.
                                </p>
                            </motion.div>
                        </div>
                    </div>
                </section>
            </main>

            <Footer />
        </div>
    );
};
