import { create } from "zustand";
import { getCurrentTime } from "@/utils/formatters";
import type { VehicleUseCase } from "@/services/vehicle.service";

interface SearchState {
  branchPublicId: string | null;
  categoryPublicId: string;
  /**
   * Where the customer will drive — required before vehicles are listed:
   * "Udupi/Manipal" (LOCAL) or "Out of Udupi" (OUT_OF_UDUPI). Sent as
   * useCases=<tripType>. null = not chosen yet.
   */
  tripType: VehicleUseCase | null;
  pickupDate: Date | null;
  returnDate: Date | null;
  pickupTime: string;
  returnTime: string;
  setSearchCriteria: (
    criteria: Partial<Omit<SearchState, "setSearchCriteria" | "resetSearch">>,
  ) => void;
  resetSearch: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  branchPublicId: null,
  categoryPublicId: "all",
  tripType: null,
  pickupDate: new Date(),
  returnDate: null,
  pickupTime: getCurrentTime(),
  returnTime: getCurrentTime(),
  setSearchCriteria: (criteria) => set((state) => ({ ...state, ...criteria })),
  resetSearch: () =>
    set({
      branchPublicId: null,
      categoryPublicId: "all",
      tripType: null,
      pickupDate: new Date(),
      returnDate: null,
      pickupTime: "10:00",
      returnTime: "10:00",
    }),
}));
