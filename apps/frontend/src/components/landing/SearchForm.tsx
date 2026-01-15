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
        <div className="w-full max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl shadow-2xl shadow-black/10 p-5 md:p-6 border border-zinc-100">
                {/* Form Flex Container */}
                <div className="flex flex-col md:flex-row gap-4 md:gap-3">

                    {/* Branch Selection */}
                    <div className="flex-1 min-w-0">
                        <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider pl-1 mb-2">
                            Branch Location
                        </label>
                        <Select
                            value={branchPublicId || ""}
                            onValueChange={(value: string) => setSearchCriteria({ branchPublicId: value })}
                            disabled={isLoading || isError}
                        >
                            <SelectTrigger className="h-12 w-full bg-zinc-100 border-0 rounded-xl text-left font-medium text-zinc-900 hover:bg-zinc-200/70 transition-colors focus:ring-2 focus:ring-orange-500 focus:ring-offset-0">
                                <div className="flex items-center gap-3">
                                    <MapPin className="size-4 text-zinc-400 shrink-0" />
                                    <SelectValue placeholder={isLoading ? "Loading..." : "Select branch"} />
                                </div>
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-zinc-200">
                                {branches?.map((branch) => (
                                    <SelectItem
                                        key={branch.publicId}
                                        value={branch.publicId}
                                        className="rounded-lg"
                                    >
                                        {branch.name}
                                    </SelectItem>
                                ))}
                                {!isLoading && (!branches || branches.length === 0) && (
                                    <div className="p-3 text-sm text-zinc-500">No branches found</div>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Pickup Date */}
                    <div className="w-full md:w-44">
                        <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider pl-1 mb-2">
                            Pickup Date
                        </label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        "h-12 w-full justify-start text-left font-medium bg-zinc-100 border-0 rounded-xl hover:bg-zinc-200/70 transition-colors focus:ring-2 focus:ring-orange-500 focus:ring-offset-0",
                                        !pickupDate && "text-zinc-500"
                                    )}
                                >
                                    <CalendarIcon className="mr-3 size-4 text-zinc-400" />
                                    {pickupDate ? (
                                        <span className="text-zinc-900">{format(pickupDate, "MMM dd, yyyy")}</span>
                                    ) : (
                                        <span>Select date</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-xl border-zinc-200" align="start">
                                <Calendar
                                    mode="single"
                                    selected={pickupDate || undefined}
                                    onSelect={(date) => setSearchCriteria({ pickupDate: date })}
                                    initialFocus
                                    disabled={(date) => {
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        return date < today;
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Return Date */}
                    <div className="w-full md:w-44">
                        <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider pl-1 mb-2">
                            Return Date
                        </label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        "h-12 w-full justify-start text-left font-medium bg-zinc-100 border-0 rounded-xl hover:bg-zinc-200/70 transition-colors focus:ring-2 focus:ring-orange-500 focus:ring-offset-0",
                                        !returnDate && "text-zinc-500"
                                    )}
                                >
                                    <CalendarIcon className="mr-3 size-4 text-zinc-400" />
                                    {returnDate ? (
                                        <span className="text-zinc-900">{format(returnDate, "MMM dd, yyyy")}</span>
                                    ) : (
                                        <span>Select date</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-xl border-zinc-200" align="start">
                                <Calendar
                                    mode="single"
                                    selected={returnDate || undefined}
                                    onSelect={(date) => setSearchCriteria({ returnDate: date })}
                                    initialFocus
                                    disabled={(date) =>
                                        (pickupDate ? date < pickupDate : date < new Date()) ||
                                        date < new Date("1900-01-01")
                                    }
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Search Button */}
                    <div className="w-full md:w-auto flex flex-col justify-end">
                        <Button
                            size="lg"
                            className={cn(
                                "h-12 w-full md:w-12 rounded-xl font-bold text-sm transition-all duration-300",
                                "bg-orange-500 hover:bg-orange-600 text-white",
                                "shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40",
                                "disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none"
                            )}
                            onClick={handleSearch}
                            disabled={!isFormValid}
                        >
                            {isLoading ? (
                                <Loader2 className="size-5 animate-spin" />
                            ) : (
                                <ArrowRight className="size-5" />
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
