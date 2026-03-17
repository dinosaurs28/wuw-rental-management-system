import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Loader2, MapPin, ArrowRight, Clock } from "lucide-react";

import { useBranches } from "@/hooks/useBranches";
import { useSearchStore } from "@/store/search.store";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { motion } from "motion/react";

export const SearchForm = () => {
    const navigate = useNavigate();
    const { data: branches, isLoading, isError } = useBranches();

    const {
        branchPublicId,
        pickupDate,
        returnDate,
        pickupTime,
        returnTime,
        setSearchCriteria,
    } = useSearchStore();

    const handleSearch = () => {
        if (branchPublicId && pickupDate && returnDate) {
            navigate("/vehicles");
        }
    };

    const isFormValid = branchPublicId && pickupDate && returnDate;

    return (
        <div className="w-full max-w-6xl mx-auto relative group z-10 font-sans">
            {/* Glowing background effect */}
            <div className="absolute -inset-4 bg-orange-500/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition duration-1000"></div>

            {/* Main Container */}
            <div className="relative bg-white xl:rounded-full rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] p-2 md:p-3 border border-zinc-100 overflow-hidden xl:overflow-visible">
                <div className="flex flex-col xl:flex-row items-center gap-2 xl:gap-0 w-full min-w-0">
                    
                    {/* Branch Selection */}
                    <div className="flex-[0.8] flex-1 w-full min-w-0 hover:bg-zinc-100/70 rounded-3xl xl:rounded-full transition-all duration-300 px-4 md:px-5 py-3">
                        <label className="block text-[11px] font-extrabold text-zinc-800 uppercase tracking-widest mb-1.5 pl-1">
                            Location
                        </label>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className="w-full bg-transparent border-0 shadow-none p-0 px-1 text-left font-semibold text-zinc-900 hover:bg-transparent focus:ring-0 [&>svg]:text-orange-500 [&>svg]:size-5 h-auto">
                                <div className="flex items-center gap-2 text-base md:text-lg w-full min-w-0">
                                    <MapPin className="size-5 shrink-0 text-orange-500" />
                                    <span className="truncate flex-1">
                                        <SelectValue placeholder={isLoading ? "Loading..." : "Where are you going?"} />
                                    </span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-3xl border-zinc-200 p-2 shadow-2xl mt-4 max-w-[200px] sm:max-w-full">
                                {branches?.map((branch) => (
                                    <SelectItem
                                        key={branch.publicId}
                                        value={branch.publicId}
                                        className="rounded-2xl py-3 px-4 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900 truncate"
                                    >
                                        {branch.name}
                                    </SelectItem>
                                ))}
                                {!isLoading && (!branches || branches.length === 0) && (
                                    <div className="p-4 text-sm text-center text-zinc-500">No locations available</div>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="hidden xl:block w-[1px] h-12 bg-zinc-200 shrink-0" />

                    {/* Pickup Container */}
                    <div className="flex-[1.2] flex-1 flex w-full min-w-0 flex-col sm:flex-row items-center gap-0 hover:bg-zinc-100/70 rounded-3xl xl:rounded-full transition-all duration-300">
                        {/* Pickup Date */}
                        <div className="flex-1 w-full min-w-0 px-4 md:px-5 py-3">
                            <label className="block text-[11px] font-extrabold text-zinc-800 uppercase tracking-widest mb-1.5 pl-1 shrink-0">
                                Pick-up Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 px-1 focus:ring-0 text-base md:text-lg hover:text-orange-600 transition-colors h-auto",
                                            !pickupDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <CalendarIcon className="size-5 shrink-0 text-zinc-400 mr-2" />
                                        <span className="truncate flex-1">{pickupDate ? format(pickupDate, "MMM dd, yyyy") : "Add date"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-3xl border-zinc-200 shadow-2xl mt-4" align="center">
                                    <Calendar
                                        mode="single"
                                        selected={pickupDate || undefined}
                                        onSelect={(date) => setSearchCriteria({ pickupDate: date })}
                                        initialFocus
                                        className="p-3 bg-white rounded-2xl"
                                        disabled={(date) => {
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0);
                                            return date < today;
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Pickup Time */}
                        <div className="w-full sm:w-[130px] lg:w-[140px] xl:w-[120px] shrink-0 min-w-0 px-4 md:px-5 py-3 border-t sm:border-t-0 sm:border-l border-zinc-200/50">
                            <label className="block text-[11px] font-extrabold text-zinc-800 uppercase tracking-widest mb-1.5 pl-1 shrink-0">
                                Time
                            </label>
                            <div className="flex items-center gap-2 px-1">
                                <Clock className="size-5 shrink-0 text-zinc-400" />
                                <input
                                    type="time"
                                    value={pickupTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ pickupTime: e.target.value })}
                                    className="bg-transparent border-0 text-zinc-900 font-semibold text-base md:text-lg focus:outline-none w-full min-w-0 shrink [color-scheme:light] p-0 h-auto"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="hidden xl:block w-[1px] h-12 bg-zinc-200 shrink-0" />

                    {/* Return Container */}
                    <div className="flex-[1.2] flex-1 flex w-full min-w-0 flex-col sm:flex-row items-center gap-0 hover:bg-zinc-100/70 rounded-3xl xl:rounded-full transition-all duration-300">
                        {/* Return Date */}
                        <div className="flex-1 w-full min-w-0 px-4 md:px-5 py-3">
                            <label className="block text-[11px] font-extrabold text-zinc-800 uppercase tracking-widest mb-1.5 pl-1 shrink-0">
                                Return Date
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 px-1 focus:ring-0 text-base md:text-lg hover:text-orange-600 transition-colors h-auto",
                                            !returnDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <CalendarIcon className="size-5 shrink-0 text-zinc-400 mr-2" />
                                        <span className="truncate flex-1">{returnDate ? format(returnDate, "MMM dd, yyyy") : "Add date"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-3xl border-zinc-200 shadow-2xl mt-4" align="center">
                                    <Calendar
                                        mode="single"
                                        selected={returnDate || undefined}
                                        onSelect={(date) => setSearchCriteria({ returnDate: date })}
                                        initialFocus
                                        className="p-3 bg-white rounded-2xl"
                                        disabled={(date) =>
                                            (pickupDate ? date < pickupDate : date < new Date()) ||
                                            date < new Date("1900-01-01")
                                        }
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Return Time */}
                        <div className="w-full sm:w-[130px] lg:w-[140px] xl:w-[120px] shrink-0 min-w-0 px-4 md:px-5 py-3 border-t sm:border-t-0 sm:border-l border-zinc-200/50">
                            <label className="block text-[11px] font-extrabold text-zinc-800 uppercase tracking-widest mb-1.5 pl-1 shrink-0">
                                Time
                            </label>
                            <div className="flex items-center gap-2 px-1">
                                <Clock className="size-5 shrink-0 text-zinc-400" />
                                <input
                                    type="time"
                                    value={returnTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ returnTime: e.target.value })}
                                    className="bg-transparent border-0 text-zinc-900 font-semibold text-base md:text-lg focus:outline-none w-full min-w-0 shrink [color-scheme:light] p-0 h-auto"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Search Button */}
                    <div className="w-full xl:w-auto p-1 xl:pl-2 shrink-0">
                        <motion.button
                            whileHover={isFormValid ? { scale: 1.05 } : {}}
                            whileTap={isFormValid ? { scale: 0.95 } : {}}
                            className={cn(
                                "h-16 w-full xl:w-20 rounded-[2rem] xl:rounded-[1.5rem] xl:hover:rounded-full bg-zinc-950 text-white flex items-center justify-center font-bold transition-all duration-300 gap-2",
                                "hover:bg-orange-500 shadow-xl shadow-zinc-950/20 hover:shadow-orange-500/30",
                                "disabled:bg-zinc-100 disabled:text-zinc-600 disabled:shadow-none disabled:cursor-not-allowed",
                                !isFormValid && "opacity-80"
                            )}
                            onClick={handleSearch}
                            disabled={!isFormValid}
                        >
                            {isLoading ? (
                                <Loader2 className="size-6 animate-spin" />
                            ) : (
                                <>
                                    <span className="xl:hidden font-bold text-lg">Search Fleet</span>
                                    <ArrowRight className="size-6" />
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </div>
        </div>
    );
};
