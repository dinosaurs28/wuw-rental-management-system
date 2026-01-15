import { create } from 'zustand';

interface SearchState {
    branchPublicId: string | null;
    pickupDate: Date | null;
    returnDate: Date | null;
    setSearchCriteria: (criteria: Partial<Omit<SearchState, 'setSearchCriteria' | 'resetSearch'>>) => void;
    resetSearch: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
    branchPublicId: null,
    pickupDate: new Date(),
    returnDate: null,
    setSearchCriteria: (criteria) => set((state) => ({ ...state, ...criteria })),
    resetSearch: () => set({ branchPublicId: null, pickupDate: new Date(), returnDate: null }),
}));
