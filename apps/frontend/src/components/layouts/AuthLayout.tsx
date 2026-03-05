import type { ReactNode } from "react";
// import authImage from "@/assets/auth-image.jpg"; // Placeholder if we had one

interface AuthLayoutProps {
    children: ReactNode;
    title: string;
    subtitle: string;
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
    return (
        <div className="flex min-h-screen w-full bg-zinc-950 selection:bg-orange-500/30">
            {/* Left Side: Image/Branding (Hidden on mobile) */}
            <div className="hidden lg:flex w-1/2 items-center justify-center relative overflow-hidden">
                {/* Branding */}
                <div className="absolute top-10 left-12 z-30">
                    <img src="/logo-W.png" alt="WUW Rentals Logo" className="h-10 w-auto opacity-90" />
                </div>
                
                {/* Gradients to blend into the darkness */}
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/40 via-zinc-950/60 to-zinc-950 z-10" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent z-20 opacity-80" />
                
                {/* Immersive Car Background */}
                <img
                    src="https://images.unsplash.com/photo-1542282088-fe8426682b8f?q=80&w=2787&auto=format&fit=crop"
                    alt="Luxury Car"
                    className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-luminosity scale-105"
                />
                
                {/* Left Side Copy */}
                <div className="relative z-30 text-white p-12 max-w-xl mt-auto mb-16 mr-auto w-full">
                    <h1 className="text-[4rem] font-serif font-black mb-6 leading-[1.05] tracking-tight drop-shadow-2xl">
                        Drive the <br/> extraordinary.
                    </h1>
                    <p className="text-xl text-zinc-400 font-medium leading-relaxed max-w-md">
                        Uncompromising luxury, meticulously curated. Experience the road like never before.
                    </p>
                </div>
            </div>

            {/* Right Side: Form wrapped in a massive rounded interlocking card */}
            <div className="flex w-full lg:w-1/2 flex-col justify-center items-center p-4 sm:p-6 lg:p-8 relative z-40 min-h-screen lg:h-screen">
                {/* The "Interlocking" White Card Background - Desktop */}
                <div className="absolute inset-y-2 right-2 left-0 lg:left-[-3rem] bg-white rounded-[3rem] shadow-[-30px_0_60px_rgba(0,0,0,0.5)] z-0 hidden lg:block border border-zinc-100/50" />
                
                {/* Mobile White Card Background - Grows with content */}
                <div className="absolute top-2 bottom-2 left-2 right-2 bg-white rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl z-0 lg:hidden border border-zinc-100" />
                
                {/* Form Content Wrapper */}
                <div className="w-full max-w-[420px] relative z-10 px-4 sm:px-6 flex flex-col justify-center py-6">
                    {/* Mobile Logo */}
                    <img src="/logo.png" alt="WUW Rentals Logo" className="h-8 sm:h-10 w-auto mr-auto lg:hidden mb-6" />
                    
                    <div className="space-y-2 mb-6 text-left">
                        <h2 className="text-3xl sm:text-4xl font-serif font-black tracking-tight text-zinc-950 leading-tight">{title}</h2>
                        <p className="text-zinc-500 font-medium text-sm sm:text-base leading-relaxed">{subtitle}</p>
                    </div>
                    <div>
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
