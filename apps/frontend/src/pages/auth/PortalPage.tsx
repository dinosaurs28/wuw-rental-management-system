import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ShieldCheck, Building2, Users, ArrowRight } from "lucide-react";

const portalOptions = [
    {
        title: "Administrator",
        description: "Global system management, branch creation, and high-level reporting.",
        icon: ShieldCheck,
        link: "/admin/sign-in",
        color: "from-orange-500 to-orange-600",
        shadow: "shadow-orange-500/20"
    },
    {
        title: "Branch Manager",
        description: "Manage branch operations, vehicles, employees, and local revenue.",
        icon: Building2,
        link: "/branch-manager/sign-in",
        color: "from-zinc-800 to-zinc-900",
        shadow: "shadow-black/20"
    },
    {
        title: "Staff / Employee",
        description: "Manage pickups, returns, and customer interactions.",
        icon: Users,
        link: "/employee/sign-in",
        color: "from-zinc-800 to-zinc-900",
        shadow: "shadow-black/20"
    }
];

export default function PortalPage() {
    return (
        <div className="min-h-screen bg-[#000000] text-white flex flex-col font-sans selection:bg-orange-500/30">
            {/* Ambient Background Glow */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-600/5 rounded-full blur-[120px]" />
            </div>

            {/* Content Container */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 md:p-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-16 max-w-2xl"
                >
                    <div className="inline-flex items-center space-x-2 bg-zinc-900/50 backdrop-blur-xl border border-white/5 px-4 py-1.5 rounded-full mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                        </span>
                        <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">Management Portals</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
                        VRMS <span className="text-orange-500">Access</span>
                    </h1>
                    <p className="text-zinc-400 text-lg md:text-xl font-medium leading-relaxed">
                        Secure entry points for specialized management and operational staff.
                        Choose your portal to begin.
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl">
                    {portalOptions.map((option, index) => (
                        <motion.div
                            key={option.title}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 * (index + 1) }}
                            whileHover={{ y: -5 }}
                            className="group"
                        >
                            <Link to={option.link} className="block h-full">
                                <div className={`relative h-full bg-zinc-900/40 backdrop-blur-md border border-white/5 rounded-[2rem] p-8 transition-all duration-300 group-hover:bg-zinc-900/60 group-hover:border-orange-500/20 shadow-2xl ${option.shadow}`}>
                                    <div className={`inline-flex items-center justify-center p-4 rounded-2xl bg-gradient-to-br ${option.color} mb-8 transition-transform duration-300 group-hover:scale-110 shadow-lg`}>
                                        <option.icon className="w-8 h-8 text-white" />
                                    </div>

                                    <h2 className="text-2xl font-bold mb-4 flex items-center group-hover:text-orange-500 transition-colors">
                                        {option.title}
                                        <ArrowRight className="ml-2 w-5 h-5 opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                                    </h2>

                                    <p className="text-zinc-400 leading-relaxed font-medium">
                                        {option.description}
                                    </p>

                                    {/* Subtle decorative element */}
                                    <div className="absolute bottom-6 right-8 text-white/5 group-hover:text-orange-500/10 transition-colors">
                                        <option.icon className="w-16 h-16" />
                                    </div>
                                </div>
                            </Link>
                        </motion.div>
                    ))}
                </div>

                {/* Footer Link back to site */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="mt-20"
                >
                    <Link to="/" className="text-zinc-500 hover:text-white transition-colors text-sm font-semibold flex items-center gap-2">
                        <ArrowRight className="w-4 h-4 rotate-180" />
                        Back to Customer Website
                    </Link>
                </motion.div>
            </main>
        </div>
    );
}
