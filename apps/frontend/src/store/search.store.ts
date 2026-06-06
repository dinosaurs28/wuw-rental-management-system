import { create } from "zustand";

function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

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
  pickupTime: getCurrentTime(),
  returnTime: getCurrentTime(),
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
