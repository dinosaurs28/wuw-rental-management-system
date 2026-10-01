import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/counterErrors";
import {
  managerDashboardService,
  type SafetyDepositRequestRow,
} from "@/services/managerDashboard.service";

const formatRupees = (value: string | number) =>
  `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

type Action = { kind: "approve" | "reject"; request: SafetyDepositRequestRow };

/**
 * Pending safety deposits Fleet requested at pickup (branch charge config:
 * "requires approval"). The BM approves an amount or rejects with a reason;
 * Fleet is notified either way (APPROVAL_RESOLVED).
 */
export const SafetyDepositRequests = ({ onChanged }: { onChanged?: () => void }) => {
  const [requests, setRequests] = useState<SafetyDepositRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = async () => {
    try {
      setIsLoading(true);
      setRequests(await managerDashboardService.getSafetyDepositRequests());
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to load safety deposit requests"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = (kind: Action["kind"], request: SafetyDepositRequestRow) => {
    setAction({ kind, request });
    setAmount(String(Number(request.requestedAmount)));
    setReason("");
  };

  const submit = async () => {
    if (!action) return;
    const { kind, request } = action;
    if (kind === "approve" && !(Number(amount) > 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (kind === "reject" && !reason.trim()) {
      toast.error("Add a reason for rejecting the deposit.");
      return;
    }
    try {
      setIsSubmitting(true);
      const res =
        kind === "approve"
          ? await managerDashboardService.approveSafetyDepositRequest(request.publicId, Number(amount))
          : await managerDashboardService.rejectSafetyDepositRequest(request.publicId, reason.trim());
      toast.success(res.message || (kind === "approve" ? "Deposit approved" : "Deposit rejected"));
      setAction(null);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Action failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-none shadow-md overflow-hidden bg-white">
      <CardHeader className="bg-gray-50/50 border-b pb-4">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-orange-500" />
          Safety deposit requests ({requests.length})
        </CardTitle>
        <CardDescription>
          Deposits Fleet asked to collect at pickup. Approve the amount or reject with a reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center p-8 text-gray-500 border rounded-lg bg-gray-50">
            No pending safety deposit requests
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((r) => {
              const vehicle = r.booking.items?.[0]?.vehicle;
              return (
                <div
                  key={r.publicId}
                  className="flex flex-col sm:flex-row justify-between sm:items-center p-4 border rounded-lg bg-white shadow-sm gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">{formatRupees(r.requestedAmount)}</span>
                      <span className="font-mono text-sm text-gray-500">#{r.booking.publicId.substring(0, 8)}</span>
                    </div>
                    {vehicle && (
                      <p className="text-sm text-gray-800">
                        {vehicle.make} {vehicle.model} ({vehicle.regNo})
                        {r.booking.customer?.user?.name ? ` · ${r.booking.customer.user.name}` : ""}
                      </p>
                    )}
                    <p className="text-sm text-gray-600 mt-1 break-words">Reason: {r.reason}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Requested by {r.requestedBy.name} · {formatWhen(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" onClick={() => open("reject", r)}>
                      Reject
                    </Button>
                    <Button onClick={() => open("approve", r)}>Approve</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={!!action} onOpenChange={(o) => !o && !isSubmitting && setAction(null)}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "approve" ? "Approve safety deposit" : "Reject safety deposit"}
            </DialogTitle>
          </DialogHeader>
          {action && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                Requested {formatRupees(action.request.requestedAmount)} by {action.request.requestedBy.name}:{" "}
                <span className="italic">"{action.request.reason}"</span>
              </p>
              {action.kind === "approve" ? (
                <div className="space-y-2">
                  <Label htmlFor="sd-approved-amount">Approved amount (₹)</Label>
                  <Input
                    id="sd-approved-amount"
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="sd-reject-reason">Reason</Label>
                  <Textarea
                    id="sd-reject-reason"
                    rows={3}
                    className="resize-none"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAction(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={isSubmitting}
              variant={action?.kind === "reject" ? "destructive" : "default"}
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {action?.kind === "approve" ? "Approve deposit" : "Reject deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
