import type { ReactNode } from "react";
// import authImage from "@/assets/auth-image.jpg"; // Placeholder if we had one

interface AuthLayoutProps {
    children: ReactNode;
    title: string;
    subtitle: string;
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
    return (
        <div className="flex min-h-screen w-full">
            {/* Left Side: Image/Branding (Hidden on mobile) */}
            <div className="hidden lg:flex w-1/2 bg-black items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-black/80 z-10" />
                {/* We can use a nice car image from Unsplash or generated one */}
                <img
                    src="https://images.unsplash.com/photo-1503376763036-066120622c74?q=80&w=2070&auto=format&fit=crop"
                    alt="Luxury Car"
                    className="absolute inset-0 w-full h-full object-cover opacity-60"
                />
                <div className="relative z-20 text-white p-12 max-w-lg">
                    <h1 className="text-5xl font-bold mb-6 leading-tight">Drive the world's finest fleet.</h1>
                    <p className="text-xl text-gray-300">From executive sedans to high-performance SUVs, unlock a premium travel experience tailored to your journey.</p>
                </div>
            </div>

            {/* Right Side: Form */}
            <div className="flex w-full lg:w-1/2 flex-col justify-center items-center p-8 bg-white dark:bg-zinc-950">
                <div className="w-full max-w-[400px] space-y-6">
                    <div className="space-y-2 text-center lg:text-left">
                        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
                        <p className="text-gray-500 dark:text-gray-400">{subtitle}</p>
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}
