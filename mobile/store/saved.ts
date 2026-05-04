import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { Vehicle } from '../types/api';

const SAVED_KEY = 'wuw_saved_vehicles';

interface SavedState {
  saved: Vehicle[];
  isLoaded: boolean;
  load: () => Promise<void>;
  toggle: (vehicle: Vehicle) => void;
  isSaved: (publicId: string) => boolean;
}

export const useSavedStore = create<SavedState>((set, get) => ({
  saved: [],
  isLoaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(SAVED_KEY);
      set({ saved: raw ? JSON.parse(raw) : [], isLoaded: true });
    } catch {
      set({ saved: [], isLoaded: true });
    }
  },

  toggle: (vehicle) => {
    const current = get().saved;
    const exists = current.some(v => v.publicId === vehicle.publicId);
    const next = exists
      ? current.filter(v => v.publicId !== vehicle.publicId)
      : [vehicle, ...current];
    set({ saved: next });
    SecureStore.setItemAsync(SAVED_KEY, JSON.stringify(next));
  },

  isSaved: (publicId) => get().saved.some(v => v.publicId === publicId),
}));
