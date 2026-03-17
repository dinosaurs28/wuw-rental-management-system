import { create } from "zustand";

interface Branch {
  publicId: string;
  name: string;
}

interface BranchState {
  branches: Branch[];
  isLoading: boolean;
  setBranches: (branches: Branch[]) => void;
  setLoading: (isLoading: boolean) => void;
  getBranchName: (publicId: string) => string | undefined;
}

export const useBranchStore = create<BranchState>((set, get) => ({
  branches: [],
  isLoading: false,
  setBranches: (branches) => set({ branches }),
  setLoading: (isLoading) => set({ isLoading }),
  getBranchName: (publicId) =>
    get().branches.find((b) => b.publicId === publicId)?.name,
}));
