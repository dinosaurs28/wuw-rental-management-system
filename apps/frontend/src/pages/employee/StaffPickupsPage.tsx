import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
    Loader2,
    ChevronRight,
    User,
    Calendar,
    Car,
    CheckCircle2,
    AlertCircle,
    FileText,
    Eye,
    X,
    Image as ImageIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
    BreadcrumbPage
} from "@/components/ui/breadcrumb";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";

import { bookingService } from "@/services/booking.service";
import { kycService, type KycDocumentType } from "@/services/kyc.service";

// --- HELPERS ---
const getDocumentTypeName = (type: string): string => {
    switch (type) {
        case 'DL': return "Driver's License";
        case 'AADHAAR': return 'Aadhaar';
        case 'PAN': return 'PAN Card';
        default: return type;
    }
};

const isImageFile = (mime: string): boolean => {
    return mime.startsWith('image/');
};

// --- VALIDATION SCHEMA ---
const handoverSchema = z.object({
    odo: z.number({ invalid_type_error: "Must be a number" }).min(0, "Odometer must be positive"),
    fuelLevel: z.string({ required_error: "Fuel level is required" }), // Select returns string
});

type HandoverFormValues = z.infer<typeof handoverSchema>;

export default function StaffPickupsPage() {
    const { bookingId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null);

    // --- DATA FETCHING ---
    const {
        data: booking,
        isLoading: isLoadingBooking,
        error: bookingError
    } = useQuery({
        queryKey: ['booking', bookingId],
        queryFn: () => bookingId ? bookingService.getPickupDetails(bookingId) : null,
        enabled: !!bookingId,
        retry: false
    });

    const {
        data: kycData,
        isLoading: isLoadingKyc
    } = useQuery({
        queryKey: ['booking-kyc', bookingId],
        queryFn: () => bookingId ? kycService.getBookingKyc(bookingId) : null,
        enabled: !!bookingId,
        retry: false
    });

    // --- MUTATIONS ---
    const verifyKycMutation = useMutation({
        mutationFn: ({ kycId, status }: { kycId: string, status: 'APPROVED' | 'REJECTED' }) =>
            kycService.verifyKyc(kycId, status),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['booking-kyc', bookingId] });
            toast.success("Document status updated");
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || "Failed to update status");
        }
    });

    const handoverMutation = useMutation({
        mutationFn: (data: { odo: number, fuelLevel: number }) =>
            bookingService.approvePickup(bookingId!, data),
        onSuccess: () => {
            toast.success("Vehicle Handover Confirmed!");
            setIsConfirmOpen(false);
            queryClient.invalidateQueries({ queryKey: ['booking', bookingId] }); // To update status banner
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || "Failed to confirm handover");
            setIsConfirmOpen(false);
        }
    });

    // --- FORM SETUP ---
    const { control, handleSubmit, watch, formState: { errors } } = useForm<HandoverFormValues>({
        resolver: zodResolver(handoverSchema),
        defaultValues: {
            fuelLevel: "", // Force selection
        },
        mode: "onChange"
    });

    // --- DERIVED STATE ---
    const kycDocs = kycData?.kyc || [];
    const areAllDocsApproved = kycDocs.length > 0 && kycDocs.every(doc => doc.status === 'APPROVED');
    // Ensure booking exists before accessing properties
    const isHandoverReady = areAllDocsApproved && watch("odo") > 0 && watch("fuelLevel") !== "";
    const isPickedUp = booking?.status === 'PICKED_UP';

    // --- FORMAT DATE ---
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    // --- HANDLERS ---
    const onConfirmHandover = (data: HandoverFormValues) => {
        handoverMutation.mutate({
            odo: data.odo,
            fuelLevel: parseInt(data.fuelLevel)
        });
    };

    if (isLoadingBooking || isLoadingKyc) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                <DashboardNavbar />
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </div>
        );
    }

    if (bookingError || !booking) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                <DashboardNavbar />
                <div className="flex-1 container py-10">
                    <Card className="max-w-md mx-auto text-center py-10">
                        <CardContent>
                            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                            <h2 className="text-xl font-semibold mb-2">Booking Not Found</h2>
                            <p className="text-muted-foreground mb-6">Create sure the Booking ID is correct.</p>
                            <Button asChild onClick={() => navigate("/employee/dashboard")}>
                                <Link to="/employee/dashboard">Back to Dashboard</Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    const vehicle = booking.items[0]?.vehicle;
    const customer = booking.customer.user;

    return (
        <div className="min-h-screen bg-gray-50/50 pb-20">
            <DashboardNavbar />

            <main className="container max-w-7xl mx-auto py-6 px-4 md:px-6 space-y-8">

                {/* 1. Breadcrumb */}
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link to="/employee/dashboard">Dashboard</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator>
                            <ChevronRight className="h-4 w-4" />
                        </BreadcrumbSeparator>
                        <BreadcrumbItem>
                            <BreadcrumbPage>Pickups</BreadcrumbPage>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator>
                            <ChevronRight className="h-4 w-4" />
                        </BreadcrumbSeparator>
                        <BreadcrumbItem>
                            <BreadcrumbPage>{booking.publicId}</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Staff Vehicle Handover</h1>
                        <p className="text-muted-foreground">Final inspection and customer verification</p>
                    </div>
                </div>

                {/* Status Banner */}
                {isPickedUp && (
                    <div className="bg-green-100 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="font-semibold">Status: PICKED UP</span>
                        <span className="ml-auto text-sm">Vehicle has been handed over successfully.</span>
                    </div>
                )}

                <div className="grid lg:grid-cols-2 gap-8">

                    {/* LEFT COLUMN */}
                    <div className="space-y-6">

                        {/* A. Customer Details Card */}
                        <Card className="shadow-sm border-gray-200">
                            <CardHeader className="pb-3 border-b bg-gray-50/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <User className="h-5 w-5 text-muted-foreground" />
                                    Customer Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 grid gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Customer Name</p>
                                        <p className="font-semibold text-gray-900">{customer.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Booking ID</p>
                                        <p className="font-mono text-gray-700">{booking.publicId}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Vehicle</p>
                                        <p className="font-medium">{vehicle?.make} {vehicle?.model}</p>
                                        <span className="text-xs text-muted-foreground">{vehicle?.regNo}</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Period</p>
                                        <div className="text-sm flex flex-col">
                                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(booking.startAt)}</span>
                                            <span className="text-muted-foreground pl-4">to</span>
                                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(booking.endAt)}</span>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* B. KYC Document Verification Card */}
                        <Card className="shadow-sm border-gray-200">
                            <CardHeader className="pb-3 border-b bg-gray-50/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-muted-foreground" />
                                    KYC Verification
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 space-y-4">
                                {kycDocs.length === 0 ? (
                                    <div className="text-center py-6 text-muted-foreground">
                                        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p>No documents uploaded yet.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {kycDocs.map((doc) => {
                                            const isImage = isImageFile(doc.file.mime);
                                            const fileName = doc.file.url.split('/').pop()?.split('?')[0] || 'Document';

                                            return (
                                                <div key={doc.publicId} className="group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/30">
                                                    {/* Thumbnail / Preview */}
                                                    <div className="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
                                                        {isImage ? (
                                                            <img
                                                                src={doc.file.url}
                                                                alt={doc.type}
                                                                className="w-full h-full object-cover"
                                                                loading="lazy"
                                                            />
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                                                <FileText className="w-12 h-12 opacity-50" />
                                                                <span className="text-xs font-medium">PDF Document</span>
                                                            </div>
                                                        )}

                                                        {/* Status Badge */}
                                                        <span className={cn(
                                                            'absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full z-10',
                                                            doc.status === 'APPROVED'
                                                                ? 'bg-emerald-100 text-emerald-700'
                                                                : doc.status === 'REJECTED'
                                                                    ? 'bg-red-100 text-red-700'
                                                                    : 'bg-amber-100 text-amber-600'
                                                        )}>
                                                            {doc.status}
                                                        </span>

                                                        {/* View Overlay Button */}
                                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                className="h-9 bg-white/90 hover:bg-white text-xs"
                                                                onClick={() => setSelectedDoc(doc)}
                                                            >
                                                                <Eye className="h-3.5 w-3.5 mr-1.5" /> View
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    {/* Info & Actions */}
                                                    <div className="p-3 bg-white flex flex-col gap-3">
                                                        <div>
                                                            <p className="font-medium text-sm text-foreground truncate">
                                                                {getDocumentTypeName(doc.type)}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                                                                {isImage ? <ImageIcon className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                                                                {fileName}
                                                            </p>
                                                        </div>

                                                        {!isPickedUp && doc.status !== 'APPROVED' && (
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    size="sm"
                                                                    className="h-8 flex-1 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 border-green-200"
                                                                    variant="outline"
                                                                    onClick={() => verifyKycMutation.mutate({ kycId: doc.publicId, status: 'APPROVED' })}
                                                                    disabled={verifyKycMutation.isPending}
                                                                >
                                                                    Approve
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    className="h-8 flex-1 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border-red-200"
                                                                    variant="outline"
                                                                    onClick={() => verifyKycMutation.mutate({ kycId: doc.publicId, status: 'REJECTED' })}
                                                                    disabled={verifyKycMutation.isPending}
                                                                >
                                                                    Reject
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="space-y-6">

                        {/* A. Vehicle Inspection Section */}
                        <Card className="shadow-sm border-gray-200">
                            <CardHeader className="pb-3 border-b bg-gray-50/50">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Car className="h-5 w-5 text-muted-foreground" />
                                    Vehicle Inspection
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <form className="space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="odo" className="text-sm font-medium">Odometer Reading (KM)</Label>
                                        <Controller
                                            name="odo"
                                            control={control}
                                            render={({ field }) => (
                                                <Input
                                                    id="odo"
                                                    type="number"
                                                    placeholder="e.g. 12500"
                                                    className="h-12"
                                                    disabled={isPickedUp}
                                                    {...field}
                                                    onChange={e => field.onChange(parseFloat(e.target.value))}
                                                />
                                            )}
                                        />
                                        {errors.odo && <p className="text-xs text-red-500">{errors.odo.message}</p>}
                                    </div>

                                    <div className="space-y-3">
                                        <Label htmlFor="fuelLevel" className="text-sm font-medium">Fuel Level</Label>
                                        <Controller
                                            name="fuelLevel"
                                            control={control}
                                            render={({ field }) => (
                                                <Select
                                                    onValueChange={field.onChange}
                                                    defaultValue={field.value}
                                                    disabled={isPickedUp}
                                                >
                                                    <SelectTrigger className="h-12">
                                                        <SelectValue placeholder="Select Fuel Level" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((level) => (
                                                            <SelectItem key={level} value={level.toString()}>
                                                                {level}%
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {errors.fuelLevel && <p className="text-xs text-red-500">{errors.fuelLevel.message}</p>}
                                    </div>

                                    {!isPickedUp && (
                                        <div className="pt-4">
                                            <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        className="w-full bg-[#FF5F00] hover:bg-[#e65600] h-12 text-base font-semibold"
                                                        disabled={!isHandoverReady || handoverMutation.isPending}
                                                    >
                                                        {handoverMutation.isPending ? (
                                                            <>
                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
                                                            </>
                                                        ) : (
                                                            "Confirm Handover"
                                                        )}
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Confirm Vehicle Handover</DialogTitle>
                                                        <DialogDescription>
                                                            Are you sure the documents and vehicle condition match the customer details?
                                                            <br />
                                                            This action cannot be undone.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter className="mt-4">
                                                        <Button variant="outline" onClick={() => setIsConfirmOpen(false)}>
                                                            Cancel
                                                        </Button>
                                                        <Button
                                                            className="bg-[#FF5F00] hover:bg-[#e65600]"
                                                            onClick={handleSubmit(onConfirmHandover)}
                                                            disabled={handoverMutation.isPending}
                                                        >
                                                            {handoverMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Handover"}
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>

                                            {!isHandoverReady && (
                                                <p className="text-xs text-center text-muted-foreground mt-3">
                                                    Complete KYC verification and vehicle details to proceed
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </form>
                            </CardContent>
                        </Card>
                    </div>


                </div>

                {/* Enhanced Document Preview Dialog */}
                {selectedDoc && (
                    <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
                        <DialogContent className="max-w-3xl w-[95vw] p-0 overflow-hidden">
                            <DialogHeader className="p-4 pb-2">
                                <DialogTitle className="text-lg font-semibold">
                                    {getDocumentTypeName(selectedDoc.type)}
                                </DialogTitle>
                                <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                                    <X className="h-4 w-4" />
                                    <span className="sr-only">Close</span>
                                </DialogClose>
                            </DialogHeader>
                            <div className="relative w-full max-h-[70vh] overflow-auto bg-muted">
                                {isImageFile(selectedDoc.file.mime) ? (
                                    <img
                                        src={selectedDoc.file.url}
                                        alt={getDocumentTypeName(selectedDoc.type)}
                                        className="w-full h-auto object-contain"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                                        <FileText className="w-16 h-16 text-muted-foreground" />
                                        <p className="text-muted-foreground">PDF Preview not available</p>
                                        <Button asChild variant="outline">
                                            <a
                                                href={selectedDoc.file.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-orange-600 hover:text-orange-700 hover:underline"
                                            >
                                                Open PDF in new tab
                                            </a>
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <div className="p-4 pt-2 border-t bg-card">
                                <p className="text-sm text-muted-foreground truncate">
                                    {selectedDoc.file.url.split('/').pop()?.split('?')[0] || 'Document'}
                                </p>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

            </main>
        </div>
    );
}
