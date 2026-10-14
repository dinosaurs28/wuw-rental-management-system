import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
    CalendarIcon,
    Loader2,
    Search,
    Car,
    Bike,
    Clock,
    Timer,
} from "lucide-react";

const getCategoryIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (/two.wheel|2.wheel|bike|scooter|moto|cycle/.test(lower)) {
        return Bike;
    }
    return Car;
};

import { useEffect, useMemo } from "react";
import { useBranches } from "@/hooks/useBranches";
import { usePublicVehicleCategories } from "@/hooks/usePublicVehicleCategories";
import { useBranchSchedule } from "@/hooks/useBranchSchedule";
import { useSearchStore } from "@/store/search.store";
import { cn } from "@/lib/utils";
import { UseCaseFilterChips } from "@/components/vehicles/UseCaseChips";
import { BranchHoursBadge } from "@/components/booking/BranchHoursBadge";
import {
    PackageHints,
    PackageQuickChips,
    PackageSelect,
    formatPackageReturn,
} from "@/components/booking/PackagePicker";
import { bookingPickerLimits, MAX_BOOKING_DAYS, snapPickupPastClosedToday } from "@/utils/bookingPickers";
import { packageRangeState, returnForNewPickup, returnForPackage } from "@/utils/bookingPackages";

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
        useCases,
        pickupDate,
        returnDate,
        pickupTime,
        returnTime,
        setSearchCriteria,
    } = useSearchStore();

    // Office hours (#2) and the 15-day window (#15) for the pickers
    const { schedule } = useBranchSchedule(branchPublicId ?? undefined);
    const limits = useMemo(
        () =>
            bookingPickerLimits({
                schedule,
                pickupDate,
                pickupTime: pickupTime || "10:00",
                returnDate,
                returnTime: returnTime || "10:00",
            }),
        [schedule, pickupDate, pickupTime, returnDate, returnTime],
    );

    // Customers book packages (12 hours / 1–15 days): the return is pickup + the
    // package, computed — never picked freely
    const packageInput = {
        schedule,
        pickupDate,
        pickupTime: pickupTime || "10:00",
        returnDate,
        returnTime: returnTime || "10:00",
    };
    const pkg = useMemo(
        () => packageRangeState(packageInput),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [schedule, pickupDate, pickupTime, returnDate, returnTime],
    );
    // A range that isn't a bookable package (none yet, hours just loaded, 12 h now out of hours) snaps to one
    const correctionKey = pkg.correction
        ? `${pkg.correction.returnDate.getTime()}|${pkg.correction.returnTime}`
        : "";
    useEffect(() => {
        if (pkg.correction) setSearchCriteria(pkg.correction);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [correctionKey]);

    /** Moves the pickup and keeps the package: the return moves with it. */
    const setPickup = (next: { pickupDate?: Date | null; pickupTime?: string }) => {
        const ret = returnForNewPickup(packageInput, {
            pickupDate: next.pickupDate !== undefined ? next.pickupDate : pickupDate,
            pickupTime: next.pickupTime ?? (pickupTime || "10:00"),
        });
        setSearchCriteria({ ...next, ...(ret ?? {}) });
    };

    const choosePackage = (packageHours: number) => {
        const ret = returnForPackage(
            { schedule, pickupDate, pickupTime: pickupTime || "10:00" },
            { packageHours, extraHours: 0 },
        );
        if (ret) setSearchCriteria(ret);
    };

    // Branch already closed for today: start the default range at its next opening
    useEffect(() => {
        const snap = snapPickupPastClosedToday({ schedule, pickupDate, returnDate, returnTime });
        if (snap) setSearchCriteria(snap);
        // Only when the hours load / the branch changes — never fights a user's pick
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schedule]);

    const isFormValid =
        !!branchPublicId && !!pickupDate && !!returnDate && !limits.windowError && !!pkg.selected && !pkg.correction;

    const handleSearch = () => {
        if (isFormValid) {
            navigate("/vehicles");
        }
    };

    // Shared field styling: one height, one type size, one border treatment
    // (phones get a compact 48 px scale so the whole form fits on one screen)
    const fieldBox =
        "h-12 sm:h-14 rounded-xl border border-zinc-300 bg-white transition-colors hover:border-zinc-400";
    const fieldLabel = "text-[13px] sm:text-sm font-semibold text-zinc-900";
    const labelRow = "flex items-center h-6 mb-1 sm:h-8 sm:mb-1.5";
    // A chip row scrolls sideways on phones instead of wrapping onto more lines
    const chipScroll =
        "flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible";

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-full max-w-[1300px] mx-auto relative z-10 font-sans text-left"
        >
            <div className="relative rounded-[20px] bg-white border border-zinc-200/70 shadow-[0_1px_2px_rgba(20,20,30,0.04),0_18px_50px_-24px_rgba(20,20,30,0.22)] p-4 sm:p-6 lg:p-7">
                {/* Category Row */}
                <div className={cn(chipScroll, "gap-2 mb-3 sm:mb-4")}>
                    <button
                        type="button"
                        onClick={() => setSearchCriteria({ categoryPublicId: "all" })}
                        aria-pressed={!categoryPublicId || categoryPublicId === "all"}
                        className={cn(
                            "flex shrink-0 items-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3.5 sm:px-4 rounded-full text-sm sm:text-[15px] font-semibold cursor-pointer transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
                            (!categoryPublicId || categoryPublicId === "all")
                                ? "bg-zinc-900 text-white"
                                : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                        )}>
                        All
                    </button>
                    {categoriesLoading ? (
                        <div className="h-9 sm:h-10 px-4 flex shrink-0 items-center gap-2 text-zinc-400 text-sm sm:text-[15px] font-semibold">
                            <Loader2 className="size-[18px] animate-spin" /> Loading
                        </div>
                    ) : (
                        categories.map(category => {
                            const CategoryIcon = getCategoryIcon(category.name);
                            const active = categoryPublicId === category.publicId;
                            return (
                                <button
                                    key={category.publicId}
                                    type="button"
                                    onClick={() => setSearchCriteria({ categoryPublicId: category.publicId })}
                                    aria-pressed={active}
                                    className={cn(
                                        "flex shrink-0 items-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3.5 sm:px-4 rounded-full text-sm sm:text-[15px] font-semibold cursor-pointer transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
                                        active
                                            ? "bg-zinc-900 text-white"
                                            : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                                    )}>
                                    <CategoryIcon className="size-4 sm:size-[18px]" strokeWidth={1.8} />
                                    {category.name}
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Trip type Row */}
                <div className={cn(chipScroll, "gap-2 sm:gap-x-3 sm:gap-y-2 mb-4 sm:mb-6")}>
                    <span className={cn(fieldLabel, "shrink-0 whitespace-nowrap")}>Trip type</span>
                    <UseCaseFilterChips
                        value={useCases}
                        onChange={(next) => setSearchCriteria({ useCases: next })}
                        className="shrink-0 flex-nowrap sm:flex-wrap [&>button]:h-8 [&>button]:px-3.5 [&>button]:text-[13px] sm:[&>button]:h-10 sm:[&>button]:px-5 sm:[&>button]:text-sm"
                    />
                </div>

                {/* Main Search Row — every column is label row (h-8) + 56 px field + its own note */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(180px,0.8fr)] gap-x-4 gap-y-3 sm:gap-y-5 w-full items-start">
                    {/* Location */}
                    <div className="sm:col-span-2 xl:col-span-1 min-w-0">
                        <div className={labelRow}>
                            <label className={fieldLabel}>Location</label>
                        </div>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className={cn(fieldBox, "w-full data-[size=default]:h-12 sm:data-[size=default]:h-14 px-3.5 sm:px-4 text-left shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:border-zinc-900 focus-visible:ring-0 [&>svg]:hidden")}>
                                <div className="flex items-center gap-2.5 sm:gap-3 text-[15px] sm:text-base font-medium w-full min-w-0">
                                    <Search className="size-[18px] sm:size-5 shrink-0 text-zinc-500" strokeWidth={2} />
                                    <span className={cn("truncate flex-1", branchPublicId ? "text-zinc-900" : "text-zinc-500")}>
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
                    <div className="min-w-0">
                        <div className={labelRow}>
                            <label className={fieldLabel}>Pick-up date</label>
                        </div>
                        <div className={cn(fieldBox, "flex items-stretch overflow-hidden focus-within:border-zinc-900")}>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "flex flex-1 items-center gap-2.5 sm:gap-3 min-w-0 h-full rounded-none justify-start px-3.5 sm:px-4 text-left bg-transparent hover:bg-zinc-50 border-0 shadow-none",
                                            !pickupDate ? "text-zinc-500" : "text-zinc-900"
                                        )}
                                    >
                                        <CalendarIcon className="size-[18px] sm:size-5 shrink-0 text-zinc-700" strokeWidth={1.8} />
                                        <span className="text-[15px] sm:text-base font-medium whitespace-nowrap truncate">
                                            {pickupDate ? format(pickupDate, "EEE, d MMM") : "Select date"}
                                        </span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2 rounded-2xl border-zinc-200 shadow-xl" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={pickupDate || undefined}
                                        onSelect={(date) => setPickup({ pickupDate: date ?? null })}
                                        initialFocus
                                        className="p-3 bg-white rounded-2xl"
                                        disabled={limits.isPickupDayDisabled}
                                    />
                                </PopoverContent>
                            </Popover>
                            <div className="w-px bg-zinc-200 shrink-0 my-2.5 sm:my-3" />
                            <div className="flex items-center h-full px-3 gap-1.5 shrink-0 hover:bg-zinc-50 transition-colors">
                                <Clock className="size-[18px] shrink-0 text-zinc-500" strokeWidth={2} />
                                <TimeSelect
                                    value={pickupTime || "10:00"}
                                    onChange={(v) => setPickup({ pickupTime: v })}
                                    isDisabled={limits.isPickupSlotDisabled}
                                    triggerClassName="text-[15px] sm:text-base font-medium text-zinc-900"
                                />
                            </div>
                        </div>
                        <BranchHoursBadge schedule={schedule} date={pickupDate} kind="pickup" className="mt-1.5 sm:mt-2" />
                    </div>

                    {/* Rental length — the return is computed (pickup + 12 hours / N days) */}
                    <div className="min-w-0">
                        <div className={cn(labelRow, "justify-between gap-2")}>
                            <label className={cn(fieldLabel, "whitespace-nowrap")}>Rental length</label>
                            <PackageQuickChips state={pkg} onSelect={choosePackage} className="gap-1.5 [&>button]:h-6 [&>button]:px-2.5 [&>button]:text-[11px] sm:[&>button]:h-7 sm:[&>button]:px-3 sm:[&>button]:text-xs" />
                        </div>
                        <PackageSelect
                            state={pkg}
                            onSelect={choosePackage}
                            icon={<Timer className="size-[18px] sm:size-5 shrink-0 text-zinc-700" strokeWidth={1.8} />}
                            triggerClassName={cn(fieldBox, "w-full data-[size=default]:h-12 sm:data-[size=default]:h-14 px-3.5 sm:px-4 text-left text-[15px] sm:text-base font-medium text-zinc-900 shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:border-zinc-900 focus-visible:ring-0")}
                        />
                        <p className="mt-1.5 sm:mt-2 text-xs sm:text-[13px] text-zinc-500">
                            Return{" "}
                            <span className="font-semibold text-zinc-900">
                                {pkg.selected ? formatPackageReturn(pkg.returnAt) : "—"}
                            </span>
                        </p>
                        <PackageHints state={pkg} className="mt-1" />
                    </div>

                    {/* Search Button */}
                    <div className="sm:col-span-2 xl:col-span-1 min-w-0">
                        <div className="hidden xl:block h-8 mb-1.5" aria-hidden="true" />
                        <motion.button
                            type="button"
                            whileTap={isFormValid ? { scale: 0.98 } : {}}
                            className={cn(
                                "h-12 sm:h-14 w-full px-5 rounded-xl bg-[#f0500a] text-white flex items-center justify-center font-semibold text-[15px] sm:text-base transition-colors whitespace-nowrap",
                                "hover:bg-[#d9470a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0500a] focus-visible:ring-offset-2",
                                "disabled:opacity-45 disabled:hover:bg-[#f0500a] disabled:cursor-not-allowed"
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
                        <p className="mt-1.5 sm:mt-2 text-xs sm:text-[13px] text-zinc-500">
                            Book 12 hours or 1–{MAX_BOOKING_DAYS} days, up to {MAX_BOOKING_DAYS} days ahead.
                        </p>
                    </div>
                </div>
                {limits.windowError && (
                    <p className="mt-3 text-sm font-semibold text-red-500">{limits.windowError}</p>
                )}
            </div>
        </motion.div>
    );
};
