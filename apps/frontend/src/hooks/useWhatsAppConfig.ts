import { useQuery } from "@tanstack/react-query";
import apiClient from "@/lib/axios";

export type PublicWhatsAppConfig = {
  phoneNumber: string;
  messageTemplate: string;
  isEnabled: boolean;
};

const fetchPublicWhatsAppConfig = async (): Promise<PublicWhatsAppConfig | null> => {
  const response = await apiClient.get("/config/whatsapp");
  return response.data.data;
};

export const useWhatsAppConfig = () => {
  return useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: fetchPublicWhatsAppConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes — matches Redis TTL
    retry: false,
  });
};

/**
 * Substitutes template variables in the message template.
 * e.g. "Help with {{bookingId}}" + { bookingId: "BK-123" } => "Help with BK-123"
 */
export const resolveTemplate = (
  template: string,
  variables: Record<string, string | number> = {}
): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in variables ? String(variables[key]) : `{{${key}}}`
  );
};
