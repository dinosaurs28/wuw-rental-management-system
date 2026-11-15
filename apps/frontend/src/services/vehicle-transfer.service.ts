/**
 * Vehicle transfer between branches (Nov 14 2026): admin (any vehicle) and
 * branch manager (own branch's vehicles) endpoints + the transfer history.
 */
import apiClient from "@/lib/axios";

export interface VehicleBranchTransfer {
  publicId: string;
  fromBranchId: string | null;
  fromBranchName: string;
  toBranchId: string | null;
  toBranchName: string;
  transferredByName: string | null;
  transferredByRole: string | null;
  reason: string;
  odometer: number | null;
  createdAt: string;
}

export interface VehicleTransferInput {
  /** Target branch publicId */
  toBranchId: string;
  reason: string;
  odometer?: number | null;
}

export interface VehicleTransferResult {
  vehicle: { publicId: string; regNo: string; odo: number };
  transfer: VehicleBranchTransfer;
  /** e.g. the new branch has no default prices for the category */
  warnings: string[];
}

export type TransferScope = "admin" | "manager";

export const transferVehicle = async (
  scope: TransferScope,
  vehiclePublicId: string,
  input: VehicleTransferInput,
): Promise<VehicleTransferResult> => {
  const url =
    scope === "admin"
      ? `/admin/dashboard/vehicle-transfer/${vehiclePublicId}`
      : `/branchManager/dashboard/vehicle/${vehiclePublicId}/transfer`;
  const res = await apiClient.post<{ data: VehicleTransferResult }>(url, input);
  return res.data.data;
};

export interface VehicleTransfersResponse {
  data: VehicleBranchTransfer[];
  /** The vehicle's branch now */
  currentBranch?: { publicId: string; name: string } | null;
}

export const fetchVehicleTransfers = async (
  scope: TransferScope,
  vehiclePublicId: string,
): Promise<VehicleTransfersResponse> => {
  const url =
    scope === "admin"
      ? `/admin/dashboard/vehicle-transfer/${vehiclePublicId}/history`
      : `/branchManager/dashboard/vehicle/${vehiclePublicId}/transfers`;
  const res = await apiClient.get<VehicleTransfersResponse>(url);
  return { data: res.data.data ?? [], currentBranch: res.data.currentBranch ?? null };
};
