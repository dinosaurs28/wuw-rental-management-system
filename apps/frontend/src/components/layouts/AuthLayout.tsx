import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Star } from "lucide-react";

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle: string;
}

export default function AuthLayout({
  children,
  title,
  subtitle,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen w-full bg-white font-sans selection:bg-orange-500/30 p-3 lg:p-4 gap-3 lg:gap-4">
      {/* Left Side: Dark hero card (matches the landing page hero) */}
      <div className="hidden lg:flex w-1/2 relative rounded-[2.5rem] overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl">
        {/* Immersive Car Background */}
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

        {/* Top bar: logo + back link */}
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-10">
          <img
            src="/logo-W.png"
            alt="WUW Rentals"
            className="h-9 w-auto opacity-95"
          />
          <Link
            to="/"
            className="group flex items-center gap-2 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
            Back home
          </Link>
        </div>

        {/* Bottom copy */}
        <div className="relative z-10 mt-auto p-12 w-full">
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="font-serif text-6xl xl:text-7xl leading-[0.95] text-zinc-50 tracking-tight"
          >
            Drive the <br />
            <span className="text-orange-500 italic pr-2">extraordinary.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6 text-lg text-zinc-400 font-medium leading-relaxed max-w-md"
          >
            Uncompromising luxury, meticulously curated. Experience the road like
            never before.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10 flex items-center gap-6"
          >
            <div className="flex items-center gap-2 text-zinc-300">
              <Star className="size-4 text-orange-500 fill-orange-500" />
              <span className="text-sm font-semibold">Premium fleet</span>
            </div>
            <div className="h-4 w-px bg-zinc-700" />
            <div className="flex items-center gap-2 text-zinc-300">
              <ShieldCheck className="size-4 text-orange-500" />
              <span className="text-sm font-semibold">24/7 concierge</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right Side: Form */}
      <div className="flex w-full lg:w-1/2 flex-col justify-center items-center relative px-2 py-8 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[440px]"
        >
          {/* Mobile logo + back */}
          <div className="flex items-center justify-between mb-10 lg:hidden">
            <img src="/logo.png" alt="WUW Rentals" className="h-8 w-auto" />
            <Link
              to="/"
              className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              <ArrowLeft className="size-4" />
              Home
            </Link>
          </div>

          <div className="space-y-2.5 mb-8 text-left">
            <h2 className="font-serif text-4xl sm:text-5xl tracking-tight text-zinc-950 leading-[1.05]">
              {title}
            </h2>
            <p className="text-zinc-500 font-medium text-base leading-relaxed">
              {subtitle}
            </p>
          </div>

          {children}
        </motion.div>
      </div>
    </div>
  );
}
