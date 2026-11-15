/**
 * Vehicle transfer between branches (Nov 14 2026): the transfer dialog (admin:
 * any vehicle; branch manager: own branch's vehicles) and the "Branch transfers"
 * history list. The server enforces every rule (not out on rent, no upcoming
 * bookings, no maintenance / open drop) and answers a clear message, shown here.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminService } from "@/services/admin.service";
import { fetchBranches } from "@/services/branch.service";
import {
  fetchVehicleTransfers,
  transferVehicle,
  type TransferScope,
  type VehicleBranchTransfer,
  type VehicleTransferResult,
} from "@/services/vehicle-transfer.service";

export interface TransferVehicleInfo {
  publicId: string;
  regNo: string;
  make: string;
  model: string;
  branchName?: string | null;
  branchPublicId?: string | null;
  odo?: number | null;
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The vehicle's transfers, newest first. `refreshKey` reloads it. */
export function VehicleTransferHistory({
  scope,
  vehiclePublicId,
  refreshKey = 0,
  title = "Branch transfers",
  onLoaded,
}: {
  scope: TransferScope;
  vehiclePublicId: string;
  refreshKey?: number;
  title?: string;
  /** The vehicle's branch now, as the server reports it */
  onLoaded?: (currentBranch: { publicId: string; name: string } | null) => void;
}) {
  const [rows, setRows] = useState<VehicleBranchTransfer[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetchVehicleTransfers(scope, vehiclePublicId)
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        onLoaded?.(r.currentBranch ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, vehiclePublicId, refreshKey]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {failed ? (
        <p className="text-xs text-red-600">Couldn't load the transfer history.</p>
      ) : rows === null ? (
        <Loader2 className="size-4 animate-spin text-gray-400" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">This vehicle has not been transferred between branches.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((t) => (
            <li key={t.publicId} className="p-3 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 font-medium text-gray-900">
                <span>{t.fromBranchName}</span>
                <ArrowRightLeft className="size-3.5 text-gray-400" aria-label="to" />
                <span>{t.toBranchName}</span>
              </div>
              <div className="text-xs text-gray-500">
                {fmtDateTime(t.createdAt)}
                {t.transferredByName ? ` · by ${t.transferredByName}` : ""}
                {t.transferredByRole === "ADMIN" ? " (admin)" : t.transferredByRole === "MANAGER" ? " (branch manager)" : ""}
                {t.odometer != null ? ` · ${t.odometer.toLocaleString("en-IN")} km` : ""}
              </div>
              <div className="text-xs text-gray-700 break-words">{t.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The transfer form in a dialog, with the vehicle's history below it. */
export function VehicleTransferDialog({
  open,
  onOpenChange,
  scope,
  vehicle,
  onTransferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: TransferScope;
  vehicle: TransferVehicleInfo | null;
  onTransferred?: (result: VehicleTransferResult, toBranch: { publicId: string; name: string }) => void;
}) {
  const [branches, setBranches] = useState<Array<{ publicId: string; name: string }>>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [toBranchId, setToBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [currentBranch, setCurrentBranch] = useState<{ publicId: string; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setToBranchId("");
    setReason("");
    setOdometer("");
    setError(null);
    setCurrentBranch(null);
    setLoadingBranches(true);
    const load =
      scope === "admin"
        ? adminService.getBranches().then((list) => list.map((b) => ({ publicId: b.publicId, name: b.name })))
        : fetchBranches();
    load
      .then(setBranches)
      .catch(() => toast.error("Failed to load branches"))
      .finally(() => setLoadingBranches(false));
  }, [open, scope]);

  const fromPublicId = vehicle?.branchPublicId ?? currentBranch?.publicId ?? null;
  const fromName = vehicle?.branchName ?? currentBranch?.name ?? null;
  const targets = useMemo(
    () => branches.filter((b) => (fromPublicId ? b.publicId !== fromPublicId : b.name !== fromName)),
    [branches, fromPublicId, fromName],
  );

  const reasonOk = reason.trim().length >= 3;
  const odoOk = odometer.trim() === "" || /^\d+$/.test(odometer.trim());
  const canSubmit = !!vehicle && !!toBranchId && reasonOk && odoOk && !saving;

  const submit = async () => {
    if (!vehicle || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const result = await transferVehicle(scope, vehicle.publicId, {
        toBranchId,
        reason: reason.trim(),
        odometer: odometer.trim() === "" ? null : Number(odometer.trim()),
      });
      const to = targets.find((b) => b.publicId === toBranchId) ?? { publicId: toBranchId, name: result.transfer.toBranchName };
      toast.success(`${vehicle.regNo} transferred to ${result.transfer.toBranchName}`);
      for (const w of result.warnings ?? []) toast.warning(w, { duration: 10000 });
      setHistoryKey((k) => k + 1);
      onTransferred?.(result, to);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to transfer the vehicle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer to another branch</DialogTitle>
          <DialogDescription>
            {vehicle
              ? `${vehicle.make} ${vehicle.model} (${vehicle.regNo})${fromName ? ` — now at ${fromName}` : ""}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Transfer to</Label>
            <Select value={toBranchId} onValueChange={setToBranchId} disabled={loadingBranches || saving}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingBranches ? "Loading branches..." : "Choose a branch"} />
              </SelectTrigger>
              <SelectContent>
                {targets.map((b) => (
                  <SelectItem key={b.publicId} value={b.publicId}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-reason">Reason</Label>
            <Textarea
              id="transfer-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Why is the vehicle moving?"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-odo">Odometer (km, optional)</Label>
            <Input
              id="transfer-odo"
              inputMode="numeric"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              placeholder={vehicle?.odo != null ? `Recorded: ${vehicle.odo}` : "Current reading"}
              disabled={saving}
            />
            {!odoOk && <p className="text-xs text-red-600">Enter whole kilometres.</p>}
          </div>
          <p className="text-xs text-gray-500">
            Past rentals stay with the branch where they happened. The vehicle can't move while it is out on rent,
            has upcoming bookings, is in maintenance or has a drop still open.
          </p>
          {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

          {vehicle && <VehicleTransferHistory
              scope={scope}
              vehiclePublicId={vehicle.publicId}
              refreshKey={historyKey}
              onLoaded={setCurrentBranch}
            />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
