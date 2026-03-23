import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
    CalendarIcon,
    Loader2,
    MapPin,
    ArrowRight,
    Clock,
    Grid3X3,
} from "lucide-react";

import { useBranches } from "@/hooks/useBranches";
import { usePublicVehicleCategories } from "@/hooks/usePublicVehicleCategories";
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
    const { data: categories = [], isLoading: categoriesLoading } = usePublicVehicleCategories();

    const {
        branchPublicId,
        categoryPublicId,
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
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-full max-w-6xl mx-auto relative z-10 font-sans"
        >
            <div className="absolute inset-x-8 -top-6 h-20 bg-orange-500/20 blur-3xl rounded-full pointer-events-none" />

            <div className="relative rounded-[2rem] md:rounded-[2.5rem] border border-zinc-200/70 bg-white/95 backdrop-blur-xl shadow-[0_24px_45px_-24px_rgba(0,0,0,0.35)] p-3.5 md:p-4.5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 items-stretch">
                    {/* Location */}
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/85 px-4 py-3">
                        <label className="block text-[10px] font-extrabold text-zinc-600 uppercase tracking-[0.22em] mb-2">
                            Location
                        </label>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className="w-full bg-transparent border-0 shadow-none p-0 h-auto text-left font-semibold text-zinc-900 hover:bg-transparent focus:ring-0 [&>svg]:hidden">
                                <div className="flex items-center gap-2 text-base w-full min-w-0">
                                    <MapPin className="size-4.5 shrink-0 text-orange-500" />
                                    <span className="truncate flex-1">
                                        <SelectValue placeholder={isLoading ? "Loading locations" : "Select location"} />
                                    </span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-zinc-200 p-2 shadow-2xl">
                                {branches?.map((branch) => (
                                    <SelectItem
                                        key={branch.publicId}
                                        value={branch.publicId}
                                        className="rounded-xl py-2.5 px-3 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900"
                                    >
                                        {branch.name}
                                    </SelectItem>
                                ))}
                                {!isLoading && (!branches || branches.length === 0) && (
                                    <div className="p-3 text-sm text-center text-zinc-500">No locations available</div>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Pickup */}
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/85 px-4 py-3">
                        <label className="block text-[10px] font-extrabold text-zinc-600 uppercase tracking-[0.22em] mb-2">
                            Pick Up
                        </label>
                        <div className="space-y-2.5">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 h-auto text-base",
                                            !pickupDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <CalendarIcon className="size-4.5 shrink-0 text-zinc-400 mr-2" />
                                        <span className="truncate">{pickupDate ? format(pickupDate, "MMM dd, yyyy") : "Select date"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-2xl border-zinc-200 shadow-2xl" align="start">
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
                            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                                <Clock className="size-4 text-zinc-500 shrink-0" />
                                <input
                                    type="time"
                                    value={pickupTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ pickupTime: e.target.value })}
                                    className="bg-transparent border-0 text-zinc-900 font-semibold text-base focus:outline-none w-full min-w-[160px] [color-scheme:light] p-0 h-auto appearance-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Category */}
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/85 px-4 py-3">
                        <label className="block text-[10px] font-extrabold text-zinc-600 uppercase tracking-[0.22em] mb-2">
                            Category
                        </label>
                        <Select
                            value={categoryPublicId || "all"}
                            onValueChange={(value: string) => setSearchCriteria({ categoryPublicId: value })}
                            disabled={categoriesLoading}
                        >
                            <SelectTrigger className="w-full bg-transparent border-0 shadow-none p-0 h-auto text-left font-semibold text-zinc-900 hover:bg-transparent focus:ring-0 [&>svg]:hidden">
                                <div className="flex items-center gap-2 text-base w-full min-w-0">
                                    <Grid3X3 className="size-4.5 shrink-0 text-orange-500" />
                                    <span className="truncate flex-1">
                                        <SelectValue placeholder={categoriesLoading ? "Loading categories" : "All categories"} />
                                    </span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-zinc-200 p-2 shadow-2xl">
                                <SelectItem
                                    value="all"
                                    className="rounded-xl py-2.5 px-3 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900"
                                >
                                    All Categories
                                </SelectItem>
                                {categories.map((category) => (
                                    <SelectItem
                                        key={category.publicId}
                                        value={category.publicId}
                                        className="rounded-xl py-2.5 px-3 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900"
                                    >
                                        {category.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Return */}
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/85 px-4 py-3">
                        <label className="block text-[10px] font-extrabold text-zinc-600 uppercase tracking-[0.22em] mb-2">
                            Return
                        </label>
                        <div className="space-y-2.5">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "w-full justify-start text-left bg-transparent hover:bg-transparent border-0 shadow-none p-0 h-auto text-base",
                                            !returnDate ? "text-zinc-500 font-medium" : "text-zinc-900 font-semibold"
                                        )}
                                    >
                                        <CalendarIcon className="size-4.5 shrink-0 text-zinc-400 mr-2" />
                                        <span className="truncate">{returnDate ? format(returnDate, "MMM dd, yyyy") : "Select date"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-2xl border-zinc-200 shadow-2xl" align="start">
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
                            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                                <Clock className="size-4 text-zinc-500 shrink-0" />
                                <input
                                    type="time"
                                    value={returnTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ returnTime: e.target.value })}
                                    className="bg-transparent border-0 text-zinc-900 font-semibold text-base focus:outline-none w-full min-w-[160px] [color-scheme:light] p-0 h-auto appearance-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Search Button */}
                    <div className="md:col-span-2">
                        <motion.button
                            whileHover={isFormValid ? { scale: 1.03 } : {}}
                            whileTap={isFormValid ? { scale: 0.97 } : {}}
                            className={cn(
                                "h-14 md:h-15 w-full rounded-2xl bg-zinc-950 text-white flex items-center justify-center font-bold transition-all duration-300 gap-2",
                                "hover:bg-orange-500 shadow-lg shadow-zinc-950/20 hover:shadow-orange-500/35",
                                "disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:cursor-not-allowed"
                            )}
                            onClick={handleSearch}
                            disabled={!isFormValid}
                        >
                            {isLoading ? (
                                <Loader2 className="size-5 animate-spin" />
                            ) : (
                                <>
                                    <span className="font-bold text-base">Search Fleet</span>
                                    <ArrowRight className="size-5" />
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
