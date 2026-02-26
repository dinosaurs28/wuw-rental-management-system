import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Loader2, MapPin, ArrowRight } from "lucide-react";

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
        setSearchCriteria
    } = useSearchStore();

    const handleSearch = () => {
        if (branchPublicId && pickupDate && returnDate) {
            navigate("/vehicles");
        }
    };

    const isFormValid = branchPublicId && pickupDate && returnDate;

    return (
        <div className="w-full max-w-5xl mx-auto relative group z-10">
            {/* Glowing background effect */}
            <div className="absolute -inset-4 bg-zinc-200/50 rounded-full blur-2xl opacity-40 group-hover:opacity-100 transition duration-1000"></div>
            
            {/* Main Unified Pill Container */}
            <div className="relative bg-white rounded-[2rem] md:rounded-full shadow-2xl p-2 md:p-3 border border-zinc-100">
                <div className="flex flex-col md:flex-row items-center divide-y md:divide-y-0 md:divide-x divide-zinc-200">

                    {/* Branch Selection */}
                    <div className="flex-1 min-w-0 w-full hover:bg-zinc-50 rounded-[1.5rem] md:rounded-full transition-colors">
                        <div className="px-6 py-3">
                            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-widest mb-1 cursor-pointer">
                                Location
                            </label>
                            <Select
                                value={branchPublicId || ""}
                                onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                                disabled={isLoading || isError}
                            >
                                <SelectTrigger className="h-8 w-full bg-transparent border-0 shadow-none p-0 text-left font-medium text-zinc-500 hover:bg-transparent focus:ring-0 [&>svg]:text-orange-500 [&>svg]:size-5">
                                    <div className="flex items-center gap-2 text-base md:text-lg">
                                        <MapPin className="size-5 shrink-0 text-zinc-400" />
                                        <div className="truncate">
                                            <SelectValue placeholder={isLoading ? "Loading..." : "Where are you going?"} />
                                        </div>
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-3xl border-zinc-200 p-2 shadow-2xl mt-4">
                                    {branches?.map((branch) => (
                                        <SelectItem
                                            key={branch.publicId}
                                            value={branch.publicId}
                                            className="rounded-2xl py-3 px-4 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900"
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
                    </div>

                    {/* Pickup Date */}
                    <div className="w-full md:w-[280px] hover:bg-zinc-50 rounded-[1.5rem] md:rounded-full transition-colors">
                        <div className="px-6 py-3">
                            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-widest mb-1 cursor-pointer">
                                Pick-up
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "h-8 w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 focus:ring-0 text-base md:text-lg hover:text-orange-600 transition-colors",
                                            !pickupDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <div className="text-zinc-400 mr-2">
                                            <CalendarIcon className="size-5" />
                                        </div>
                                        {pickupDate ? (
                                            <span className="truncate">{format(pickupDate, "MMM dd, yyyy")}</span>
                                        ) : (
                                            <span className="truncate">Add dates</span>
                                        )}
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
                    </div>

                    {/* Return Date */}
                    <div className="w-full md:w-[280px] hover:bg-zinc-50 rounded-[1.5rem] md:rounded-full transition-colors">
                        <div className="px-6 py-3">
                            <label className="block text-[11px] font-bold text-zinc-800 uppercase tracking-widest mb-1 cursor-pointer">
                                Return
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "h-8 w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 focus:ring-0 text-base md:text-lg hover:text-orange-600 transition-colors",
                                            !returnDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <div className="text-zinc-400 mr-2">
                                            <CalendarIcon className="size-5" />
                                        </div>
                                        {returnDate ? (
                                            <span className="truncate">{format(returnDate, "MMM dd, yyyy")}</span>
                                        ) : (
                                            <span className="truncate">Add dates</span>
                                        )}
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
                    </div>

                    {/* Search Button */}
                    <div className="w-full md:w-auto p-2 md:pl-4">
                        <motion.button
                            whileHover={isFormValid ? { scale: 1.05 } : {}}
                            whileTap={isFormValid ? { scale: 0.95 } : {}}
                            className={cn(
                                "h-16 w-full md:w-20 lg:w-32 flex items-center justify-center rounded-[1.5rem] md:rounded-full font-bold transition-all duration-300 gap-2",
                                "bg-zinc-950 text-white hover:bg-orange-500",
                                "shadow-xl shadow-zinc-950/20 hover:shadow-orange-500/30",
                                "disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed",
                                !isFormValid && "opacity-80"
                            )}
                            onClick={handleSearch}
                            disabled={!isFormValid}
                        >
                            {isLoading ? (
                                <Loader2 className="size-6 animate-spin" />
                            ) : (
                                <>
                                    <span className="md:hidden lg:inline-block font-bold">Search</span>
                                    <ArrowRight className="size-5 md:size-6" />
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </div>
        </div>
    );
};
