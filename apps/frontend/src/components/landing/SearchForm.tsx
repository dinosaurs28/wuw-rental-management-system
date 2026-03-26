import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
    CalendarIcon,
    Loader2,
    Search,
    Car,
    Clock,
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
            className="w-full max-w-[1300px] mx-auto relative z-10 font-sans"
        >
            <div className="relative rounded-[2rem] bg-white border border-zinc-200/70 shadow-[0_24px_45px_-24px_rgba(0,0,0,0.15)] p-5 md:p-6 lg:p-8">
                {/* Top Bar: Dynamic Category Tabs & View Booking */}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
                    <div className="flex items-center flex-wrap gap-1.5 p-1 bg-zinc-100/80 rounded-2xl md:rounded-full border border-zinc-200/50 max-w-full">
                        <button
                            onClick={() => setSearchCriteria({ categoryPublicId: "all" })}
                            className={cn(
                                "flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all focus:outline-none whitespace-nowrap",
                                (!categoryPublicId || categoryPublicId === "all")
                                    ? "bg-zinc-900 text-white shadow-sm"
                                    : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                            )}>
                            All Types
                        </button>
                        {categoriesLoading ? (
                            <div className="px-5 py-2.5 flex items-center gap-2 text-zinc-400 text-sm font-semibold">
                                <Loader2 className="size-4 animate-spin" /> Loading
                            </div>
                        ) : (
                            categories.map(category => (
                                <button
                                    key={category.publicId}
                                    onClick={() => setSearchCriteria({ categoryPublicId: category.publicId })}
                                    className={cn(
                                        "flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all focus:outline-none whitespace-nowrap",
                                        categoryPublicId === category.publicId
                                            ? "bg-zinc-900 text-white shadow-sm"
                                            : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                                    )}>
                                    <Car className="size-4" strokeWidth={2.5} />
                                    {category.name}
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Main Search Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_152px] gap-3 w-full items-end">
                    {/* Location */}
                    <div className="sm:col-span-2 lg:col-span-1 relative">
                        <label className="block text-xs font-bold text-zinc-900 mb-2.5">
                            Location
                        </label>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className="w-full h-[54px] bg-white border border-zinc-200 rounded-[14px] px-3 xl:px-4 text-left font-medium text-zinc-900 hover:border-zinc-300 transition-colors shadow-none focus:ring-0 [&>svg]:hidden">
                                <div className="flex items-center gap-3 text-[15px] xl:text-base w-full min-w-0">
                                    <Search className="size-5 shrink-0 text-zinc-900" strokeWidth={2.5} />
                                    <span className={cn("truncate flex-1 font-medium", !branchPublicId && "text-zinc-400 placeholder")}>
                                        <SelectValue placeholder={isLoading ? "Loading locations..." : "Airport, city or address"} />
                                    </span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-zinc-200 p-2 shadow-2xl">
                                {branches?.map((branch) => (
                                    <SelectItem
                                        key={branch.publicId}
                                        value={branch.publicId}
                                        className="rounded-[10px] py-2.5 px-3 cursor-pointer font-medium focus:bg-zinc-100 focus:text-zinc-900"
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

                    {/* Pick-up Date & Time */}
                    <div className="relative">
                        <label className="block text-xs font-bold text-zinc-900 mb-2.5">
                            Pick-up date
                        </label>
                        <div className="flex items-center h-[54px] rounded-[14px] border border-zinc-200 bg-white overflow-hidden transition-colors focus-within:border-zinc-300 group">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "flex-1 h-full rounded-none justify-start px-3 xl:px-4 text-left bg-transparent hover:bg-zinc-50 border-0 shadow-none font-medium gap-2 xl:gap-3",
                                            !pickupDate ? "text-zinc-400" : "text-zinc-900"
                                        )}
                                    >
                                        <CalendarIcon className="size-5 shrink-0 text-zinc-900" strokeWidth={2} />
                                        <span className="truncate text-[15px] xl:text-base">{pickupDate ? format(pickupDate, "MMM do") : "Select"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-2xl border-zinc-200 shadow-xl" align="start">
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
                            <div className="h-3/5 w-[1px] bg-zinc-200 shrink-0" />
                            <div className="relative flex items-center h-full px-2 xl:px-3 hover:bg-zinc-50 transition-colors shrink-0">
                                <input
                                    type="time"
                                    onClick={(e) => {
                                        try {
                                            if ('showPicker' in HTMLInputElement.prototype) {
                                                e.currentTarget.showPicker();
                                            }
                                        } catch (err) { }
                                    }}
                                    value={pickupTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ pickupTime: e.target.value })}
                                    className="h-full bg-transparent border-0 text-zinc-900 font-medium text-[15px] focus:outline-none w-[115px] [color-scheme:light] appearance-none cursor-pointer p-0 m-0 pr-7 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:z-10"
                                />
                                <Clock className="size-4 shrink-0 text-zinc-900 pointer-events-none absolute right-2" strokeWidth={2.5} />
                            </div>
                        </div>
                    </div>

                    {/* Return Date & Time */}
                    <div className="relative">
                        <label className="block text-xs font-bold text-zinc-900 mb-2.5">
                            Return date
                        </label>
                        <div className="flex items-center h-[54px] rounded-[14px] border border-zinc-200 bg-white overflow-hidden transition-colors focus-within:border-zinc-300 group">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "flex-1 h-full rounded-none justify-start px-3 xl:px-4 text-left bg-transparent hover:bg-zinc-50 border-0 shadow-none font-medium gap-2 xl:gap-3",
                                            !returnDate ? "text-zinc-400" : "text-zinc-900"
                                        )}
                                    >
                                        <CalendarIcon className="size-5 shrink-0 text-zinc-900" strokeWidth={2} />
                                        <span className="truncate text-[15px] xl:text-base">{returnDate ? format(returnDate, "MMM do") : "Select"}</span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-2xl border-zinc-200 shadow-xl" align="start">
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
                            <div className="h-3/5 w-[1px] bg-zinc-200 shrink-0" />
                            <div className="relative flex items-center h-full px-2 xl:px-3 hover:bg-zinc-50 transition-colors shrink-0">
                                <input
                                    type="time"
                                    onClick={(e) => {
                                        try {
                                            if ('showPicker' in HTMLInputElement.prototype) {
                                                e.currentTarget.showPicker();
                                            }
                                        } catch (err) { }
                                    }}
                                    value={returnTime || "10:00"}
                                    onChange={(e) => setSearchCriteria({ returnTime: e.target.value })}
                                    className="h-full bg-transparent border-0 text-zinc-900 font-medium text-[15px] focus:outline-none w-[115px] [color-scheme:light] appearance-none cursor-pointer p-0 m-0 pr-7 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:z-10"
                                />
                                <Clock className="size-4 shrink-0 text-zinc-900 pointer-events-none absolute right-2" strokeWidth={2.5} />
                            </div>
                        </div>
                    </div>

                    {/* Search Button */}
                    <div className="sm:col-span-2 lg:col-span-1">
                        <motion.button
                            whileHover={isFormValid ? { scale: 1.02 } : {}}
                            whileTap={isFormValid ? { scale: 0.98 } : {}}
                            className={cn(
                                "h-[54px] px-8 rounded-[14px] bg-[#FF5A00] text-white flex items-center justify-center font-bold text-[15px] transition-all duration-300 w-full whitespace-nowrap",
                                "hover:bg-[#E55100] focus:outline-none focus:ring-2 focus:ring-[#FF5A00] focus:ring-offset-2 shadow-lg shadow-[#FF5A00]/20 hover:shadow-[#FF5A00]/40",
                                "disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none disabled:cursor-not-allowed"
                            )}
                            onClick={handleSearch}
                            disabled={!isFormValid}
                        >
                            {isLoading ? (
                                <Loader2 className="size-5 animate-spin mx-auto" />
                            ) : (
                                "Show vehicles"
                            )}
                        </motion.button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
