import { create } from "zustand";

interface SearchState {
  branchPublicId: string | null;
  categoryPublicId: string;
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
  pickupDate: new Date(),
  returnDate: null,
  pickupTime: "10:00",
  returnTime: "10:00",
  setSearchCriteria: (criteria) => set((state) => ({ ...state, ...criteria })),
  resetSearch: () =>
    set({
      branchPublicId: null,
      categoryPublicId: "all",
      pickupDate: new Date(),
      returnDate: null,
      pickupTime: "10:00",
      returnTime: "10:00",
    }),
}));
