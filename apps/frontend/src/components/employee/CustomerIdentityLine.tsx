import { useQuery } from "@tanstack/react-query";
import { maskAadhaar } from "@repo/schemas";

import { cn } from "@/lib/utils";
import {
  employeeCustomerKey,
  employeeCustomerService,
} from "@/services/employeeCustomer.service";

interface CustomerIdentityLineProps {
  publicId: string;
  className?: string;
}

/**
 * The session customer's DL number and masked Aadhaar number (#1), so staff
 * can cross-check them against the documents at the counter. Renders nothing
 * until loaded; shows "Not added" for a number the profile doesn't have yet.
 */
export function CustomerIdentityLine({
  publicId,
  className,
}: CustomerIdentityLineProps) {
  const { data } = useQuery({
    queryKey: employeeCustomerKey(publicId),
    queryFn: () => employeeCustomerService.getCustomer(publicId),
    enabled: !!publicId,
    staleTime: 30 * 1000,
    retry: false,
  });

  if (!data) return null;

  const aadhaar = data.aadhaarNumber ? maskAadhaar(data.aadhaarNumber) : null;

  return (
    <p className={cn("text-xs font-mono", className)}>
      DL {data.drivingLicenceNumber || "Not added"} &middot; Aadhaar{" "}
      {aadhaar || "Not added"}
    </p>
  );
}
