import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CarFront, Undo2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { managerDashboardService } from "@/services/managerDashboard.service";

export const ManagerConfirmations = () => {
  const [confirmations, setConfirmations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Dialog State
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);

  // Form State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [chargeDeposit, setChargeDeposit] = useState(false);
  const [safetyDepositAmount, setSafetyDepositAmount] = useState<number | "">("");
  const [safetyDepositMethod, setSafetyDepositMethod] = useState("ONLINE_RAZORPAY");
  const [refundDepositFull, setRefundDepositFull] = useState(false);

  useEffect(() => {
    loadConfirmations();
  }, []);

  const loadConfirmations = async () => {
    try {
      setIsLoading(true);
      const data = await managerDashboardService.getManagerConfirmations();
      setConfirmations(data);
    } catch (error) {
      toast.error("Failed to load manager confirmations");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReview = async (bookingId: string) => {
    setSelectedBookingId(bookingId);
    setDetails(null);
    setChargeDeposit(false);
    setSafetyDepositAmount("");
    setSafetyDepositMethod("ONLINE_RAZORPAY");
    setRefundDepositFull(false);
    setIsDialogOpen(true);
    
    try {
      setIsDetailsLoading(true);
      const data = await managerDashboardService.getConfirmationDetails(bookingId);
      setDetails(data);
    } catch (error) {
      toast.error("Failed to load booking details");
      setIsDialogOpen(false);
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const handleConfirmPickup = async () => {
    if (!selectedBookingId) return;

    if (chargeDeposit) {
      if (!safetyDepositAmount || Number(safetyDepositAmount) <= 0) {
        toast.error("Please enter a valid safety deposit amount");
        return;
      }
    }

    try {
      setIsSubmitting(true);
      
      if (chargeDeposit) {
        await managerDashboardService.collectSafetyDeposit(selectedBookingId, {
          amount: Number(safetyDepositAmount),
          method: safetyDepositMethod,
        });
      }

      const res = await managerDashboardService.confirmPickupWithDeposit(selectedBookingId, {
        requireManagerConfirmation: false
      });
      toast.success(res.message || "Pickup confirmed successfully");
      setIsDialogOpen(false);
      loadConfirmations();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to confirm pickup");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefundOrConfirmReturn = async () => {
    if (!selectedBookingId) return;

    try {
      setIsSubmitting(true);
      if (refundDepositFull && Number(details?.safetyDeposit) > 0) {
        const res = await managerDashboardService.refundSafetyDeposit(selectedBookingId, Number(details.safetyDeposit));
        toast.success(res.message || "Refund processed");
      } else {
        // Otherwise use the confirm return route directly
        const res = await managerDashboardService.confirmReturnManager(selectedBookingId);
        toast.success(res.message || "Return confirmed successfully");
      }
      setIsDialogOpen(false);
      loadConfirmations();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Action failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const pickupConfirmations = confirmations.filter((c) => c.status === "CONFIRMED");
  const returnConfirmations = confirmations.filter((c) => c.status === "PICKED_UP");

  const renderBookingCard = (booking: any, isPickup: boolean) => (
    <div
      key={booking.publicId}
      className="flex flex-col sm:flex-row justify-between sm:items-center p-4 border rounded-lg bg-white shadow-sm gap-4"
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className="border-orange-200 text-orange-600 bg-orange-50">
            {isPickup ? "Pickup Review" : "Return Review"}
          </Badge>
          <span className="font-mono text-sm text-gray-500">#{booking.publicId.substring(0, 8)}</span>
        </div>
        <h4 className="font-semibold text-lg text-gray-900">
          {booking.items?.[0]?.vehicle?.make} {booking.items?.[0]?.vehicle?.model} (
          {booking.items?.[0]?.vehicle?.regNo})
        </h4>
        <p className="text-sm text-gray-600 mt-1">
          Customer: <span className="font-medium text-gray-900">{booking.customer?.user?.name}</span>
        </p>
      </div>
      <Button onClick={() => handleReview(booking.publicId)}>Review & Action</Button>
    </div>
  );

  return (
    <Card className="border-none shadow-md overflow-hidden bg-white mt-8">
      <CardHeader className="bg-gray-50/50 border-b pb-4">
        <div className="flex items-center gap-2 text-orange-600 mb-1">
          <AlertCircle className="w-5 h-5" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Requires Action</h2>
        </div>
        <CardTitle className="text-2xl font-bold">Manager Confirmations</CardTitle>
        <CardDescription>
          Bookings flagged by staff that require branch manager approval before completion.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="pickup" className="w-full">
          <div className="px-6 pt-4">
            <TabsList className="grid w-[400px] grid-cols-2">
              <TabsTrigger value="pickup" className="flex items-center gap-2">
                <CarFront className="w-4 h-4" /> Pickups ({pickupConfirmations.length})
              </TabsTrigger>
              <TabsTrigger value="return" className="flex items-center gap-2">
                <Undo2 className="w-4 h-4" /> Returns ({returnConfirmations.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="pickup" className="p-6">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
            ) : pickupConfirmations.length === 0 ? (
              <div className="text-center p-8 text-gray-500 border rounded-lg bg-gray-50">No pending pickup confirmations</div>
            ) : (
              <div className="space-y-4">{pickupConfirmations.map(c => renderBookingCard(c, true))}</div>
            )}
          </TabsContent>

          <TabsContent value="return" className="p-6">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
            ) : returnConfirmations.length === 0 ? (
              <div className="text-center p-8 text-gray-500 border rounded-lg bg-gray-50">No pending return confirmations</div>
            ) : (
              <div className="space-y-4">{returnConfirmations.map(c => renderBookingCard(c, false))}</div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {details?.status === "CONFIRMED" ? "Approve Pickup Request" : "Approve Return Request"}
            </DialogTitle>
          </DialogHeader>

          {isDetailsLoading || !details ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
          ) : (
            <div className="space-y-6 pt-4">
              <div className="bg-gray-50 p-4 rounded-lg border text-sm space-y-2">
                <p><strong>Customer:</strong> {details.customer.user.name} ({details.customer.user.phone})</p>
                <p><strong>Vehicle:</strong> {details.items[0].vehicle.make} {details.items[0].vehicle.model} - {details.items[0].vehicle.regNo}</p>
                <div className="flex gap-4 mt-2">
                  <Badge variant="secondary">Recorded ODO: {details.items[0].vehicle.odo} km</Badge>
                  <Badge variant="secondary">Recorded Fuel: {details.items[0].vehicle.fuelLevel}%</Badge>
                </div>
              </div>

              {details.photos && details.photos.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 text-sm text-gray-700">Staff Uploaded Media</h4>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {details.photos.map((p: any) => (
                      <img key={p.id} src={p.file.url} alt="Proof" className="w-24 h-24 object-cover rounded border" />
                    ))}
                  </div>
                </div>
              )}

              {details.status === "CONFIRMED" && (
                <div className="bg-orange-50/50 p-4 rounded-lg border border-orange-100">
                  <div className="flex items-center space-x-2 mb-4">
                    <Checkbox id="chargeDeposit" checked={chargeDeposit} onCheckedChange={(c) => setChargeDeposit(!!c)} />
                    <Label htmlFor="chargeDeposit" className="font-medium cursor-pointer">Charge a Safe Deposit</Label>
                  </div>

                  {chargeDeposit && (
                    <div className="space-y-4 pl-6 border-l-2 border-orange-200 ml-2 mt-2">
                      <div className="space-y-2">
                        <Label>Deposit Amount (₹)</Label>
                        <Input type="number" placeholder="Eg: 5000" value={safetyDepositAmount} onChange={(e) => setSafetyDepositAmount(e.target.value ? Number(e.target.value) : "")} />
                      </div>
                      <div className="space-y-2">
                        <Label>Payment Method</Label>
                        <Select value={safetyDepositMethod} onValueChange={setSafetyDepositMethod}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ONLINE_RAZORPAY">Online (Razorpay Link)</SelectItem>
                            <SelectItem value="CASH">Cash</SelectItem>
                            <SelectItem value="UPI">UPI</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {details.status === "PICKED_UP" && (
                <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                  <h4 className="font-medium mb-2">Previous Deposit Information</h4>
                  <p className="text-sm mb-4">
                    Deposit Held: <strong>₹{details.safetyDeposit || 0}</strong>
                    {details.safetyDeposit ? ` (${details.safetyDepositMethod})` : ''}
                  </p>

                  {Number(details.safetyDeposit) > 0 && (
                    <div className="flex items-center space-x-2 mt-4 bg-white p-3 rounded border">
                      <Checkbox 
                        id="refundDepositFull" 
                        checked={refundDepositFull} 
                        onCheckedChange={(c) => setRefundDepositFull(!!c)} 
                      />
                      <Label htmlFor="refundDepositFull" className="font-medium cursor-pointer">
                        Issue Full Refund (₹{details.safetyDeposit})
                      </Label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>Cancel</Button>
            {details?.status === "CONFIRMED" ? (
              <Button onClick={handleConfirmPickup} disabled={isSubmitting || isDetailsLoading}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Finalize & Approve Pickup
              </Button>
            ) : (
              <Button onClick={handleRefundOrConfirmReturn} variant="default" disabled={isSubmitting || isDetailsLoading}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Finalize & Approve Return
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
