import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
    CalendarIcon,
    Loader2,
    Search,
    Car,
    Bike,
    Clock,
} from "lucide-react";

const getCategoryIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (/two.wheel|2.wheel|bike|scooter|moto|cycle/.test(lower)) {
        return Bike;
    }
    return Car;
};

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
import { TimeSelect } from "@/components/ui/TimeSelect";
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
            <div className="relative rounded-[22px] bg-white border border-zinc-200/70 shadow-[0_1px_2px_rgba(20,20,30,0.04),0_18px_50px_-24px_rgba(20,20,30,0.22)] pt-[26px] px-[30px] pb-[30px]">
                {/* Category Row */}
                <div className="flex items-center flex-wrap gap-[10px] mb-[26px]">
                    <button
                        onClick={() => setSearchCriteria({ categoryPublicId: "all" })}
                        className={cn(
                            "flex items-center gap-[9px] h-[52px] px-6 border-none rounded-full text-[18px] font-semibold tracking-[-0.01em] cursor-pointer transition-all duration-150 focus:outline-none whitespace-nowrap",
                            (!categoryPublicId || categoryPublicId === "all")
                                ? "bg-zinc-900 text-white"
                                : "bg-[#f3f3f5] text-zinc-900 hover:bg-[#e9e9ec]"
                        )}>
                        All
                    </button>
                    {categoriesLoading ? (
                        <div className="h-[52px] px-6 flex items-center gap-[9px] text-zinc-400 text-[18px] font-semibold tracking-[-0.01em]">
                            <Loader2 className="size-[22px] animate-spin" /> Loading
                        </div>
                    ) : (
                        categories.map(category => {
                            const CategoryIcon = getCategoryIcon(category.name);
                            return (
                                <button
                                    key={category.publicId}
                                    onClick={() => setSearchCriteria({ categoryPublicId: category.publicId })}
                                    className={cn(
                                        "flex items-center gap-[9px] h-[52px] px-6 border-none rounded-full text-[18px] font-semibold tracking-[-0.01em] cursor-pointer transition-all duration-150 focus:outline-none whitespace-nowrap",
                                        categoryPublicId === category.publicId
                                            ? "bg-zinc-900 text-white"
                                            : "bg-[#f3f3f5] text-zinc-900 hover:bg-[#e9e9ec]"
                                    )}>
                                    <CategoryIcon className="size-[22px]" strokeWidth={1.8} />
                                    {category.name}
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Main Search Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_200px] gap-7 w-full items-end">
                    {/* Location */}
                    <div className="sm:col-span-2 lg:col-span-1 relative">
                        <label className="block text-[15px] font-bold tracking-[-0.01em] text-zinc-900 mb-[10px] pl-0.5">
                            Location
                        </label>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className="w-full h-[64px] bg-white border-[1.5px] border-zinc-200 rounded-[14px] px-5 text-left font-medium text-zinc-900 hover:border-zinc-300 focus:border-zinc-900 transition-colors shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden">
                                <div className="flex items-center gap-[14px] text-[19px] font-medium tracking-[-0.01em] w-full min-w-0">
                                    <Search className="size-[22px] shrink-0 text-zinc-500" strokeWidth={2} />
                                    <span className={cn("truncate flex-1", !branchPublicId && "text-[#8a8a93]")}>
                                        <SelectValue placeholder={isLoading ? "Loading locations..." : "Search city, airport or address"} />
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
                        <label className="block text-[15px] font-bold tracking-[-0.01em] text-zinc-900 mb-[10px] pl-0.5">
                            Pick-up date
                        </label>
                        <div className="flex items-stretch h-[64px] rounded-[14px] border-[1.5px] border-zinc-200 bg-white overflow-hidden transition-colors focus-within:border-zinc-900 focus-within:shadow-[0_0_0_3px_rgba(22,22,26,0.06)]">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "flex items-center gap-[12px] min-w-[158px] h-full rounded-none justify-start px-5 text-left bg-transparent hover:bg-[#fafafb] border-0 shadow-none font-medium",
                                            !pickupDate ? "text-[#8a8a93]" : "text-zinc-900"
                                        )}
                                    >
                                        <CalendarIcon className="size-[22px] shrink-0 text-zinc-900" strokeWidth={1.8} />
                                        <span className="text-[19px] font-medium tracking-[-0.01em] whitespace-nowrap">
                                            {pickupDate ? format(pickupDate, "MMM do") : "Select"}
                                        </span>
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
                            <div className="h-full w-[1.5px] bg-zinc-200 shrink-0" />
                            <div className="flex items-center h-full px-[14px] gap-1 hover:bg-[#fafafb] transition-colors">
                                <Clock className="size-[18px] shrink-0 text-zinc-400" strokeWidth={2} />
                                <TimeSelect
                                    value={pickupTime || "10:00"}
                                    onChange={(v) => setSearchCriteria({ pickupTime: v })}
                                    triggerClassName="text-[17px] font-medium tracking-[-0.01em] text-zinc-900"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Return Date & Time */}
                    <div className="relative">
                        <label className="block text-[15px] font-bold tracking-[-0.01em] text-zinc-900 mb-[10px] pl-0.5">
                            Return date
                        </label>
                        <div className="flex items-stretch h-[64px] rounded-[14px] border-[1.5px] border-zinc-200 bg-white overflow-hidden transition-colors focus-within:border-zinc-900 focus-within:shadow-[0_0_0_3px_rgba(22,22,26,0.06)]">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "flex items-center gap-[12px] min-w-[158px] h-full rounded-none justify-start px-5 text-left bg-transparent hover:bg-[#fafafb] border-0 shadow-none font-medium",
                                            !returnDate ? "text-[#8a8a93]" : "text-zinc-900"
                                        )}
                                    >
                                        <CalendarIcon className="size-[22px] shrink-0 text-zinc-900" strokeWidth={1.8} />
                                        <span className="text-[19px] font-medium tracking-[-0.01em] whitespace-nowrap">
                                            {returnDate ? format(returnDate, "MMM do") : "Select"}
                                        </span>
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
                            <div className="h-full w-[1.5px] bg-zinc-200 shrink-0" />
                            <div className="flex items-center h-full px-[14px] gap-1 hover:bg-[#fafafb] transition-colors">
                                <Clock className="size-[18px] shrink-0 text-zinc-400" strokeWidth={2} />
                                <TimeSelect
                                    value={returnTime || "10:00"}
                                    onChange={(v) => setSearchCriteria({ returnTime: v })}
                                    triggerClassName="text-[17px] font-medium tracking-[-0.01em] text-zinc-900"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Search Button */}
                    <div className="sm:col-span-2 lg:col-span-1">
                        <motion.button
                            whileHover={isFormValid ? { scale: 1.02 } : {}}
                            whileTap={isFormValid ? { scale: 0.98 } : {}}
                            className={cn(
                                "h-[64px] px-6 rounded-[14px] bg-[#f0500a] text-white flex items-center justify-center font-bold text-[19px] tracking-[-0.01em] transition-all duration-200 w-full whitespace-nowrap",
                                "hover:bg-[#d9470a] focus:outline-none focus:ring-2 focus:ring-[#f0500a] focus:ring-offset-2",
                                "disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed"
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
