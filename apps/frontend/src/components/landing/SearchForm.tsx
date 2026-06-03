import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Search, Loader2 } from "lucide-react";

import { useBranches } from "@/hooks/useBranches";
import { usePublicVehicleCategories } from "@/hooks/usePublicVehicleCategories";
import { useSearchStore } from "@/store/search.store";
import { cn } from "@/lib/utils";

import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverAnchor,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AnimatePresence, motion } from "motion/react";
import { useState, useEffect, useRef } from "react";
import { type DateRange } from "react-day-picker";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, [matches, query]);
  return matches;
}

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

    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isCompactCalendarOpen, setIsCompactCalendarOpen] = useState(false);
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    const isTablet = useMediaQuery("(min-width: 768px)");

    // Show a compact sticky search bar once the main widget scrolls out of view.
    const widgetRef = useRef<HTMLDivElement>(null);
    const [showCompact, setShowCompact] = useState(false);
    useEffect(() => {
        const el = widgetRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setShowCompact(!entry.isIntersecting),
            { threshold: 0, rootMargin: "-88px 0px 0px 0px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleSearch = () => {
        if (branchPublicId && pickupDate && returnDate) {
            navigate("/vehicles");
        }
    };

    const isFormValid = branchPublicId && pickupDate && returnDate;

    // Helper for rendering the range calendar
    const renderCalendar = (onClose: () => void) => (
        <Calendar
            mode="range"
            selected={{
                from: pickupDate || undefined,
                to: returnDate || undefined,
            }}
            onSelect={(range: DateRange | undefined) => {
                setSearchCriteria({
                    pickupDate: range?.from,
                    returnDate: range?.to,
                });
                if (range?.from && range?.to) {
                    onClose();
                }
            }}
            initialFocus
            numberOfMonths={isDesktop ? 3 : isTablet ? 2 : 1}
            className="bg-white rounded-xl"
            disabled={(date) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return date < today;
            }}
        />
    );

    return (
        <div className="w-full relative z-20 font-sans">
            <motion.div
                ref={widgetRef}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="bg-white rounded-2xl shadow-xl overflow-hidden"
            >
                <div className="p-4 md:p-6 lg:p-8">
                    {/* Category Tabs (backend-driven vehicle categories) */}
                    <div className="flex items-center flex-wrap gap-1.5 bg-gray-100 p-1 rounded-full w-full md:w-fit mb-6 overflow-x-auto no-scrollbar">
                        <button
                            type="button"
                            onClick={() => setSearchCriteria({ categoryPublicId: "all" })}
                            className={cn(
                                "px-5 py-2 rounded-full text-sm font-bold transition-colors whitespace-nowrap",
                                (!categoryPublicId || categoryPublicId === "all")
                                    ? "bg-gray-900 text-white"
                                    : "text-gray-700 hover:bg-gray-200"
                            )}
                        >
                            All Types
                        </button>
                        {categoriesLoading ? (
                            <span className="px-5 py-2 flex items-center gap-2 text-gray-400 text-sm font-bold">
                                <Loader2 className="size-4 animate-spin" /> Loading
                            </span>
                        ) : (
                            categories.map((category) => (
                                <button
                                    key={category.publicId}
                                    type="button"
                                    onClick={() => setSearchCriteria({ categoryPublicId: category.publicId })}
                                    className={cn(
                                        "px-5 py-2 rounded-full text-sm font-bold transition-colors whitespace-nowrap",
                                        categoryPublicId === category.publicId
                                            ? "bg-gray-900 text-white"
                                            : "text-gray-700 hover:bg-gray-200"
                                    )}
                                >
                                    {category.name}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Main Form Area */}
                    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                        <PopoverAnchor asChild>
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,1fr)_auto_auto_auto] gap-4 items-end">

                                {/* Pickup Location */}
                                <div className="w-full">
                                    <label className="block text-xs font-bold text-gray-900 mb-2">
                                        Pickup & return
                                    </label>
                                    <div className="relative w-full">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-900" strokeWidth={2.5} />
                                        <Select
                                            value={branchPublicId || ""}
                                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                                            disabled={isLoading || isError}
                                        >
                                            <SelectTrigger className="w-full data-[size=default]:h-[52px] bg-white border border-gray-300 rounded-lg pl-10 pr-4 text-left font-normal text-gray-900 hover:border-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-colors shadow-none text-base [&>svg]:hidden truncate">
                                                <SelectValue placeholder={isLoading ? "Loading..." : "Airport, city or address"} />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-lg border-gray-200 shadow-xl">
                                                {branches?.map((branch) => (
                                                    <SelectItem
                                                        key={branch.publicId}
                                                        value={branch.publicId}
                                                        className="py-3 px-4 cursor-pointer focus:bg-gray-100 font-medium"
                                                    >
                                                        {branch.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Pickup Date & Time */}
                                <div className="w-full lg:w-auto">
                                    <label className="block text-xs font-bold text-gray-900 mb-2">
                                        Pickup date
                                    </label>
                                    <div className="flex h-[52px] border border-gray-300 rounded-lg overflow-hidden focus-within:border-[#FF5F00] focus-within:ring-1 focus-within:ring-[#FF5F00] transition-shadow">
                                        {/* Date */}
                                        <button type="button" onClick={() => setIsCalendarOpen(true)} className="flex items-center gap-2 px-3 h-full bg-white hover:bg-gray-50 border-r border-gray-300 text-sm font-medium min-w-[130px] outline-none">
                                            <CalendarIcon className="size-5 text-gray-900" strokeWidth={2} />
                                            <span className={!pickupDate ? "text-gray-400" : "text-gray-900"}>
                                                {pickupDate ? format(pickupDate, "MMM dd") : "Select"}
                                            </span>
                                        </button>
                                        {/* Time */}
                                        <div className="flex items-center px-3 bg-white hover:bg-gray-50 h-full relative">
                                            <input
                                                type="time"
                                                value={pickupTime || "12:00"}
                                                onChange={(e) => setSearchCriteria({ pickupTime: e.target.value })}
                                                className="h-full bg-transparent border-0 text-sm font-medium text-gray-900 focus:outline-none w-[75px] [color-scheme:light] p-0 m-0 cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Return Date & Time */}
                                <div className="w-full lg:w-auto">
                                    <label className="block text-xs font-bold text-gray-900 mb-2">
                                        Return date
                                    </label>
                                    <div className="flex h-[52px] border border-gray-300 rounded-lg overflow-hidden focus-within:border-[#FF5F00] focus-within:ring-1 focus-within:ring-[#FF5F00] transition-shadow">
                                        {/* Date */}
                                        <button type="button" onClick={() => setIsCalendarOpen(true)} className="flex items-center gap-2 px-3 h-full bg-white hover:bg-gray-50 border-r border-gray-300 text-sm font-medium min-w-[130px] outline-none">
                                            <CalendarIcon className="size-5 text-gray-900" strokeWidth={2} />
                                            <span className={!returnDate ? "text-gray-400" : "text-gray-900"}>
                                                {returnDate ? format(returnDate, "MMM dd") : "Select"}
                                            </span>
                                        </button>
                                        {/* Time */}
                                        <div className="flex items-center px-3 bg-white hover:bg-gray-50 h-full relative">
                                            <input
                                                type="time"
                                                value={returnTime || "12:00"}
                                                onChange={(e) => setSearchCriteria({ returnTime: e.target.value })}
                                                className="h-full bg-transparent border-0 text-sm font-medium text-gray-900 focus:outline-none w-[75px] [color-scheme:light] p-0 m-0 cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Submit Button */}
                                <div className="w-full lg:w-[160px]">
                                    <button
                                        type="button"
                                        onClick={handleSearch}
                                        disabled={!isFormValid}
                                        className={cn(
                                            "w-full h-[52px] bg-[#FF5F00] hover:bg-[#E55500] text-white font-bold rounded-lg transition-colors",
                                            "disabled:bg-[#F3F4F6] disabled:text-gray-400 disabled:cursor-not-allowed"
                                        )}
                                    >
                                        Show cars
                                    </button>
                                </div>
                            </div>
                        </PopoverAnchor>

                        <PopoverContent
                            className="w-auto p-0 rounded-2xl border border-gray-200 shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden"
                            align="center"
                            sideOffset={16}
                        >
                            {renderCalendar(() => setIsCalendarOpen(false))}
                        </PopoverContent>
                    </Popover>
                </div>
            </motion.div>

            {/* Compact sticky search bar — appears once the main widget scrolls past the top */}
            <AnimatePresence>
                {showCompact && (
                    <motion.div
                        initial={{ y: -120, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -120, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="fixed top-20 left-0 right-0 z-40 bg-white border-b border-gray-200 shadow-md"
                    >
                        <div className="w-full max-w-[1300px] mx-auto px-4 md:px-6 lg:px-12 h-16 flex items-center gap-3">
                            <img src="/logo.png" alt="WUW Rentals" className="h-7 w-auto object-contain hidden sm:block shrink-0" />

                            {/* Location */}
                            <div className="relative flex-1 min-w-0 hidden md:block">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-900" strokeWidth={2.5} />
                                <Select
                                    value={branchPublicId || ""}
                                    onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                                    disabled={isLoading || isError}
                                >
                                    <SelectTrigger className="w-full data-[size=default]:h-10 bg-white border border-gray-300 rounded-lg pl-9 pr-3 text-left font-normal text-gray-900 hover:border-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-colors shadow-none text-sm [&>svg]:hidden truncate">
                                        <SelectValue placeholder={isLoading ? "Loading..." : "Airport, city or address"} />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-lg border-gray-200 shadow-xl">
                                        {branches?.map((branch) => (
                                            <SelectItem
                                                key={branch.publicId}
                                                value={branch.publicId}
                                                className="py-2.5 px-4 cursor-pointer focus:bg-gray-100 font-medium"
                                            >
                                                {branch.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Dates */}
                            <Popover open={isCompactCalendarOpen} onOpenChange={setIsCompactCalendarOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 h-10 px-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-sm font-medium text-gray-900 whitespace-nowrap shrink-0 outline-none focus:border-gray-900"
                                    >
                                        <CalendarIcon className="size-4 text-gray-900" strokeWidth={2} />
                                        <span className={!pickupDate ? "text-gray-400" : "text-gray-900"}>
                                            {pickupDate ? format(pickupDate, "MMM dd") : "Select"}
                                        </span>
                                        <span className="text-gray-300">→</span>
                                        <span className={!returnDate ? "text-gray-400" : "text-gray-900"}>
                                            {returnDate ? format(returnDate, "MMM dd") : "Select"}
                                        </span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-auto p-0 rounded-2xl border border-gray-200 shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden"
                                    align="end"
                                    sideOffset={12}
                                >
                                    {renderCalendar(() => setIsCompactCalendarOpen(false))}
                                </PopoverContent>
                            </Popover>

                            {/* Submit */}
                            <button
                                type="button"
                                onClick={handleSearch}
                                disabled={!isFormValid}
                                className={cn(
                                    "h-10 px-5 bg-[#FF5F00] hover:bg-[#E55500] text-white font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 text-sm",
                                    "disabled:bg-[#F3F4F6] disabled:text-gray-400 disabled:cursor-not-allowed"
                                )}
                            >
                                Show cars
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
