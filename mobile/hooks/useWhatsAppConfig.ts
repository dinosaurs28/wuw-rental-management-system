import { useQuery } from '@tanstack/react-query';
import { configApi } from '../lib/api';
import type { WhatsAppConfig } from '../types/api';

// Mirrors web useWhatsAppConfig: returns the config or null when disabled/missing.
export function useWhatsAppConfig() {
  return useQuery<WhatsAppConfig | null>({
    queryKey: ['whatsapp-config'],
    queryFn: async () => {
      const res = await configApi.whatsapp();
      return (res.data?.data ?? null) as WhatsAppConfig | null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
