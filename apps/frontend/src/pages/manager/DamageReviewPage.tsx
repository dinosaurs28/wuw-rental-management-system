import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';

import { ManagerLayout } from '@/components/manager/ManagerLayout';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';


import { DamageEvidence } from '@/components/manager/damage/DamageEvidence';
import { DamageSummary } from '@/components/manager/damage/DamageSummary';
import { FinancialCalculation } from '@/components/manager/damage/FinancialCalculation';
import { VehicleDisposition } from '@/components/manager/damage/VehicleDisposition';

import { getDamageReport, closeDamageReport, type DamageReport } from '@/services/damage.service';
import { formatCurrency, cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

export const DamageReviewPage = () => {
    const { damageReportId } = useParams<{ damageReportId: string }>();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [report, setReport] = useState<DamageReport | null>(null);

    // Form State
    const [finalCost, setFinalCost] = useState<number>(0);
    const [disposition, setDisposition] = useState<'AVAILABLE' | 'MAINTENANCE' | 'DAMAGED'>('AVAILABLE');
    const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ONLINE_RAZORPAY' | undefined>(undefined);
    const [managerNotes, setManagerNotes] = useState("");
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    useEffect(() => {
        if (!damageReportId) {
            toast.error("Invalid Damage Report ID");
            navigate('/manager/dashboard');
            return;
        }
        loadReport(damageReportId);
    }, [damageReportId]);

    const loadReport = async (id: string) => {
        try {
            setIsLoading(true);
            const data = await getDamageReport(id);
            setReport(data);

            // Initialize form defaults
            setFinalCost(data.financialHint.estimatedCost || 0);
            // Default disposition logic could be smarter, but 'AVAILABLE' is a safe default unless major damage.

        } catch (error: any) {
            console.error("Failed to load report", error);
            const msg = error.response?.data?.message || "Failed to load damage report";
            toast.error(msg);
            if (error.response?.status === 401 || error.response?.status === 403) {
                navigate('/branch-manager/sign-in');
            } else {
                navigate('/manager/dashboard');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmClose = async () => {
        if (!report) return;

        const balance = report.booking.deposit - finalCost;
        const isDue = balance < 0;

        if (isDue && !paymentMethod) {
            toast.error("Please select a payment method for the due amount.");
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await closeDamageReport(report.damageReportId, {
                disposition,
                finalCost,
                paymentMethod,
                redirectUrl: `${window.location.origin}/manager/payment/fine-status`
            });

            if (response.paymentUrl) {
                // Redirect to payment gateway
                window.location.href = response.paymentUrl;
            } else {
                toast.success("Damage Report Closed Successfully");
                // Redirect to dashboard or success page
                navigate('/manager/dashboard');
            }

        } catch (error: any) {
            console.error("Failed to close report", error);
            toast.error(error.response?.data?.message || "Failed to close report");
            setIsConfirmOpen(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <ManagerLayout>
                <div className="flex h-[80vh] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </ManagerLayout>
        );
    }

    if (!report) return null;

    const balance = report.booking.deposit - finalCost;
    const isRefund = balance >= 0;

    return (
        <ManagerLayout>
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-6 pb-24">
                {/* Header */}
                <div className="flex flex-col gap-4 mb-6">
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/dashboard?tab=damage">Damage Reports</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Review {report.damageReportId.slice(-6).toUpperCase()}</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-lg border shadow-sm">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                    {report.vehicle.make} {report.vehicle.model}
                                    <Badge variant="outline" className="ml-2 font-mono text-xs">{report.vehicle.regNo}</Badge>
                                </h1>
                                <p className="text-sm text-gray-500">
                                    Booking #{report.booking.bookingId.slice(-6)} • {report.vehicle.currentStatus}
                                </p>
                            </div>
                        </div>
                        <Badge variant={report.status === 'PENDING' ? 'secondary' : 'default'} className="md:text-lg px-4 py-1">
                            {report.status}
                        </Badge>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* LEFT COLUMN: EVIDENCE */}
                    <div className="space-y-6">
                        <DamageEvidence
                            images={report.images}
                            damageDetails={report.damageDetails}
                            vehicleType={report.vehicle.make.includes('Scooter') ? 'Two Wheeler' : 'Four Wheeler'} // Naive check
                        />
                    </div>

                    {/* RIGHT COLUMN: SUMMARY & ACTIONS */}
                    <div className="flex flex-col gap-6">

                        <DamageSummary damageDetails={report.damageDetails} />

                        {report.status === 'APPROVED' ? (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center space-y-4">
                                <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
                                <div>
                                    <h3 className="text-xl font-bold text-green-800">Damage Report Closed</h3>
                                    <p className="text-green-700">This report has been approved and settled.</p>
                                </div>
                                <div className="text-left bg-white p-4 rounded-md border border-green-100 flex justify-center">
                                    <div className="text-center">
                                        <label className="text-xs text-gray-500 block mb-1">Disposition</label>
                                        <Badge variant="outline">{report.vehicle.currentStatus}</Badge>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Manager Inputs (Only for Pending) */
                            <div className="space-y-6">
                                <CardWrapper title="Manager Remarks">
                                    <textarea
                                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        placeholder="Add internal notes explaining the decision..."
                                        value={managerNotes}
                                        onChange={(e) => setManagerNotes(e.target.value)}
                                    />
                                </CardWrapper>

                                <FinancialCalculation
                                    deposit={report.booking.deposit}
                                    finalCost={finalCost}
                                    setFinalCost={setFinalCost}
                                    paymentMethod={paymentMethod}
                                    setPaymentMethod={setPaymentMethod}
                                />

                                <VehicleDisposition
                                    disposition={disposition}
                                    setDisposition={setDisposition}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Sticky Footer Actions (Only for Pending) */}
                {report.status !== 'APPROVED' && (
                    <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-50 md:pl-64">
                        <div className="max-w-[1440px] mx-auto flex items-center justify-between md:justify-end gap-4">
                            <Button variant="outline" onClick={() => navigate(-1)} disabled={isSubmitting}>
                                Cancel / Needs Info
                            </Button>

                            <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                                <DialogTrigger asChild>
                                    <Button size="lg" className={cn("min-w-[200px]", isRefund ? "bg-green-600 hover:bg-green-700" : "bg-primary")}>
                                        {isRefund ? "Confirm Refund & Close" : "Confirm Payment & Close"}
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle className="flex items-center gap-2">
                                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                            Confirm Action
                                        </DialogTitle>
                                        <DialogDescription>
                                            This action is irreversible. Please verify all details.
                                        </DialogDescription>
                                    </DialogHeader>

                                    <div className="space-y-3 py-4 text-sm bg-gray-50 p-4 rounded-md">
                                        <div className="flex justify-between">
                                            <span>Total Damage Cost:</span>
                                            <span className="font-semibold">{formatCurrency(finalCost)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Settlement Type:</span>
                                            <span className={isRefund ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                                                {isRefund ? "REFUND" : "COLLECTION DUE"}
                                            </span>
                                        </div>
                                        {!isRefund && (
                                            <div className="flex justify-between">
                                                <span>Payment Method:</span>
                                                <span className="font-semibold">{paymentMethod?.replace('_', ' ')}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between pt-2 border-t mt-2">
                                            <span>Vehicle Status:</span>
                                            <Badge variant="outline">{disposition}</Badge>
                                        </div>
                                    </div>

                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsConfirmOpen(false)}>Cancel</Button>
                                        <Button onClick={handleConfirmClose} disabled={isSubmitting} className={cn(isRefund ? "bg-green-600 hover:bg-green-700" : "")}>
                                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {isRefund ? "Process Refund" : "Collect & Close"}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                )}
            </div>
        </ManagerLayout>
    );
};

const CardWrapper = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <Label className="text-sm font-semibold text-gray-700">{title}</Label>
        {children}
    </div>
);

export default DamageReviewPage;
