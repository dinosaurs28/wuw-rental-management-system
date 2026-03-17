export interface CustomerSession {
  publicId: string;
  phone: string;
  name: string;
  profileCompleted: boolean;
  kycStatus: boolean;
}

const STORAGE_KEY = "employee_customer_session";

export const customerSession = {
  get: (): CustomerSession | null => {
    if (typeof window === "undefined") return null;
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  },

  set: (session: CustomerSession) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  },

  clear: () => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  },

  exists: (): boolean => {
    return !!customerSession.get();
  },
};
