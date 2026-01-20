
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { bookingService } from "@/services/booking.service";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Upload, Trash2, ArrowLeft, Fuel, Gauge, AlertTriangle, FileCheck, Info, X } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";

interface DamageItem {
    id: string;
    area: string;
    type: string;
    severity: string;
    description: string;
    photos: string[]; // publicIds
}

export default function ReturnProcessPage() {
    const { bookingId } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // State
    const [odo, setOdo] = useState<number>(0);
    const [fuel, setFuel] = useState<number>(100);
    const [returnPhotos, setReturnPhotos] = useState<string[]>([]); // publicIds
    const [hasDamage, setHasDamage] = useState(false);

    // Damage Report State
    const [damages, setDamages] = useState<DamageItem[]>([]);
    const [activeDamage, setActiveDamage] = useState<Partial<DamageItem>>({
        severity: "Minor"
    });
    const [showDamageForm, setShowDamageForm] = useState(false);

    // Dialog Control
    const [showCompleteDialog, setShowCompleteDialog] = useState(false);
    const [showReportDialog, setShowReportDialog] = useState(false);

    // Queries
    const { data: booking, isLoading, error } = useQuery({
        queryKey: ["booking", bookingId],
        queryFn: () => bookingService.getReturnDetails(bookingId!),
        enabled: !!bookingId,
    });

    useEffect(() => {
        if (booking && booking.items[0].vehicle) {
            const v = booking.items[0].vehicle;
            if (v.odo) setOdo(v.odo);
            if (v.fuelLevel) setFuel(v.fuelLevel);
        }
    }, [booking]);

    // Mutations
    const uploadReturnMutation = useMutation({
        mutationFn: bookingService.uploadReturnImage,
        onSuccess: (data) => {
            setReturnPhotos(prev => [...prev, data.fileId]);
            toast.success("Return photo uploaded");
        },
        onError: () => toast.error("Failed to upload photo")
    });

    const uploadDamageMutation = useMutation({
        mutationFn: bookingService.uploadDamageImage,
        onSuccess: (data) => {
            setActiveDamage(prev => ({
                ...prev,
                photos: [...(prev.photos || []), data.fileId]
            }));
            toast.success("Damage photo uploaded");
        },
        onError: () => toast.error("Failed to upload damage photo")
    });

    const completeReturnMutation = useMutation({
        mutationFn: (data: { returnImageIds: string[] }) =>
            bookingService.completeReturn(bookingId!, data),
        onSuccess: () => {
            toast.success("Return completed successfully");
            setShowCompleteDialog(false);
            queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
            // Don't redirect, update UI state
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.message || "Failed to complete return");
        }
    });

    const reportDamageMutation = useMutation({
        mutationFn: (data: any) => bookingService.reportDamage(data),
        onSuccess: () => {
            toast.success("Damage report submitted successfully");
            setShowReportDialog(false);
            queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.message || "Failed to submit damage report");
        }
    });

    // Handlers
    const onDropReturn = (acceptedFiles: File[]) => {
        acceptedFiles.forEach(file => {
            const formData = new FormData();
            formData.append("file", file);
            uploadReturnMutation.mutate(formData);
        });
    };

    const { getRootProps: getReturnRootProps, getInputProps: getReturnInputProps } = useDropzone({
        onDrop: onDropReturn,
        accept: { 'image/*': [] }
    });

    const onDropDamage = (acceptedFiles: File[]) => {
        acceptedFiles.forEach(file => {
            const formData = new FormData();
            formData.append("file", file);
            uploadDamageMutation.mutate(formData);
        });
    };

    const { getRootProps: getDamageRootProps, getInputProps: getDamageInputProps } = useDropzone({
        onDrop: onDropDamage,
        accept: { 'image/*': [] }
    });

    const addDamageItem = () => {
        if (!activeDamage.area || !activeDamage.type || !activeDamage.description) {
            toast.error("Please fill all damage fields");
            return;
        }
        setDamages(prev => [...prev, { ...activeDamage, id: Math.random().toString(36).substr(2, 9) } as DamageItem]);
        setActiveDamage({ severity: "Minor", photos: [] });
        setShowDamageForm(false);
    };

    const removeDamageItem = (id: string) => {
        setDamages(prev => prev.filter(d => d.id !== id));
    };

    const handleCompleteReturn = () => {
        if (returnPhotos.length === 0) {
            toast.error("Please upload return condition photos");
            return;
        }
        completeReturnMutation.mutate({ returnImageIds: returnPhotos });
    };

    const handleReportDamage = () => {
        if (damages.length === 0) {
            toast.error("Please add at least one damage entry");
            return;
        }
        reportDamageMutation.mutate({
            bookingId: bookingId,
            odo,
            fuelLevel: fuel,
            severity: damages.some(d => d.severity === "Severe") ? "Severe" : damages.some(d => d.severity === "Moderate") ? "Moderate" : "Minor",
            damageImageIds: damages.flatMap(d => d.photos),
            notes: { damages },
            returnImageIds: returnPhotos
        });
    };

    if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    if (error || !booking) return <div className="min-h-screen flex items-center justify-center text-red-500">Failed to load booking details</div>;

    const vehicle = booking.items[0]?.vehicle;
    const isCompleted = booking.status === "RETURNED" || booking.status === "COMPLETED";

    // Zones based on logic (simplified here)
    const isTwoWheeler = vehicle?.category?.toLowerCase().includes("two");
    const damageZones = isTwoWheeler
        ? ["Front", "Rear", "Left Side", "Right Side"]
        : ["Front Bumper", "Rear Bumper", "Left Front Door", "Left Rear Door", "Right Front Door", "Right Rear Door", "Hood", "Roof", "Trunk", "Wheels", "Interior"];

    return (
        <div className="min-h-screen bg-[#F5F5F5] pb-20">
            <DashboardNavbar />

            <div className="container mx-auto max-w-[1280px] py-8 space-y-8">
                {/* Breadcrumb */}
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/employee/dashboard">Home</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/employee/dashboard">Returns</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Return Inspection</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-4xl font-bold tracking-tight text-primary">Return Inspection</h1>
                            <Badge variant={isCompleted ? "outline" : "secondary"} className={cn("uppercase px-3 py-1", isCompleted && "bg-green-100 text-green-700 border-green-200")}>
                                {booking.status.replace("_", " ")}
                            </Badge>
                        </div>
                        <p className="text-muted-foreground flex items-center gap-4 text-sm">
                            <span>License: <span className="font-mono text-foreground font-medium">{vehicle?.regNo}</span></span>
                            <span>•</span>
                            <span>Customer: <span className="font-medium text-foreground">{booking.customer.user.name}</span></span>
                            <span>•</span>
                            <span>Ref: #{booking.publicId.substring(0, 8)}</span>
                        </p>
                    </div>
                    <Button variant="outline" className="border-orange-500 text-orange-500 hover:bg-orange-50 px-6" onClick={() => navigate("/employee/dashboard")}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Queue
                    </Button>
                </div>

                {isCompleted && (
                    <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center gap-3">
                        <FileCheck className="h-5 w-5" />
                        <div>
                            <p className="font-semibold">Return Completed</p>
                            <p className="text-sm">This vehicle has been returned and processed.</p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Form Area */}
                    <div className="lg:col-span-2 space-y-8">

                        {/* 1. Return Media Upload */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="px-6 pt-6">
                                <CardTitle className="text-2xl">1. Return Media Upload</CardTitle>
                                <CardDescription className="text-base">Upload general condition photos of the vehicle (4-6 photos recommended).</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6">
                                <div {...getReturnRootProps()} className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center hover:bg-gray-50 transition-colors cursor-pointer bg-white">
                                    <input {...getReturnInputProps()} disabled={isCompleted} />
                                    <Upload className="mx-auto h-12 w-12 text-[#999999] mb-4" />
                                    <p className="text-base text-[#666666] font-medium">Drag & drop photos here, or click to browse</p>
                                    <p className="text-sm text-[#999999] mt-2">Supports JPG, PNG</p>
                                </div>

                                {returnPhotos.length > 0 && (
                                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-4 mt-6">
                                        {returnPhotos.map((_, idx) => (
                                            <div key={idx} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
                                                {/* Placeholder for preview since we only have ID. In real app we might need URL or object URL */}
                                                <div className="w-full h-full flex items-center justify-center bg-gray-100 text-xs text-gray-400">
                                                    Img {idx + 1}
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setReturnPhotos(prev => prev.filter((_, i) => i !== idx)) }}
                                                    className="absolute top-1 right-1 bg-black/50 hover:bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                    disabled={isCompleted}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 2. Condition Check */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="px-6 pt-6">
                                <CardTitle className="text-2xl">2. Vehicle Condition Check</CardTitle>
                            </CardHeader>
                            <CardContent className="p-6">
                                <div className="flex items-start space-x-4 p-6 border rounded-lg bg-white hover:border-orange-200 transition-colors cursor-pointer" onClick={() => !isCompleted && setHasDamage(!hasDamage)}>
                                    <Checkbox
                                        id="damage-check"
                                        checked={hasDamage}
                                        onCheckedChange={(c) => setHasDamage(!!c)}
                                        disabled={isCompleted}
                                    />
                                    <div className="grid gap-1.5 leading-none">
                                        <Label htmlFor="damage-check" className="text-base font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                            Does the vehicle have any new damage?
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Enable this if you identify scratches, dents, or other issues.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 3. Damage Details (Conditional) */}
                        {hasDamage && (
                            <Card className="border-orange-200">
                                <CardHeader className="bg-orange-50/50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-orange-700">
                                            <AlertTriangle className="h-5 w-5" />
                                            <CardTitle>3. Damage Report Details</CardTitle>
                                        </div>
                                        <Button size="sm" variant="outline" onClick={() => setShowDamageForm(true)} disabled={isCompleted}>
                                            + Add Damage Entry
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    {showDamageForm && (
                                        <div className="mb-6 p-4 border rounded-lg space-y-4 bg-background animate-in fade-in slide-in-from-top-2">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Area</Label>
                                                    <Select onValueChange={(v) => setActiveDamage({ ...activeDamage, area: v })}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select Area" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {damageZones.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Severity</Label>
                                                    <Select defaultValue="Minor" onValueChange={(v) => setActiveDamage({ ...activeDamage, severity: v })}>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="Minor">Minor</SelectItem>
                                                            <SelectItem value="Moderate">Moderate</SelectItem>
                                                            <SelectItem value="Severe">Severe</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Description</Label>
                                                <Input
                                                    placeholder="Describe the damage (e.g. 5cm scratch)"
                                                    onChange={(e) => setActiveDamage({ ...activeDamage, description: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Photos of Damage</Label>
                                                <div {...getDamageRootProps()} className="border border-dashed p-4 rounded text-center text-sm cursor-pointer hover:bg-muted">
                                                    <input {...getDamageInputProps()} />
                                                    <p>Click to upload damage photos</p>
                                                </div>
                                                {activeDamage.photos && activeDamage.photos.length > 0 && (
                                                    <p className="text-xs text-green-600 mt-1">{activeDamage.photos.length} photos attached</p>
                                                )}
                                            </div>
                                            <div className="flex justify-end gap-2 pt-2">
                                                <Button variant="ghost" size="sm" onClick={() => setShowDamageForm(false)}>Cancel</Button>
                                                <Button size="sm" onClick={addDamageItem}>Save Entry</Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* List of damages */}
                                    <div className="space-y-3">
                                        {damages.map(item => (
                                            <div key={item.id} className="flex items-start justify-between p-3 border rounded-md bg-white shadow-sm">
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold">{item.area}</span>
                                                        <Badge variant={item.severity === 'Severe' ? 'destructive' : 'outline'}>{item.severity}</Badge>
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">{item.description}</p>
                                                    {item.photos.length > 0 && <p className="text-xs text-blue-600 flex items-center gap-1"><Info className="h-3 w-3" /> {item.photos.length} photos</p>}
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeDamageItem(item.id)} disabled={isCompleted}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))}
                                        {damages.length === 0 && !showDamageForm && (
                                            <p className="text-sm text-muted-foreground text-center py-4">No damage reported yet.</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Sidebar / Metrics */}
                    <div className="space-y-8">
                        {/* 4. Return Metrics */}
                        <Card className="border-none shadow-sm h-fit">
                            <CardHeader className="px-6 pt-6">
                                <CardTitle className="text-xl">4. Return Metrics</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Odometer Reading (km)</Label>
                                    <Input
                                        type="number"
                                        value={odo}
                                        onChange={(e) => setOdo(Number(e.target.value))}
                                        placeholder="Enter current KM"
                                        className="text-lg font-mono"
                                        disabled={isCompleted}
                                    />
                                    <p className="text-xs text-muted-foreground">Pickup: 12,450 km (Not validated)</p>
                                </div>

                                <Separator />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2"><Fuel className="h-4 w-4" /> Fuel Level</Label>
                                        <span className="text-lg font-bold">{fuel}%</span>
                                    </div>
                                    <Slider
                                        value={[fuel]}
                                        max={100}
                                        step={5}
                                        onValueChange={(v) => setFuel(v[0])}
                                        className="py-4"
                                        disabled={isCompleted}
                                    />
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Empty</span>
                                        <span>Full</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 5. Actions */}
                        <Card className="bg-[#1A1A1A] text-white border-none shadow-lg">
                            <CardHeader>
                                <CardTitle className="text-white">Return Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-400">Base Rental</span>
                                    <span className="font-medium text-white">Paid</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-400">Reported Damage</span>
                                    <span className={cn("font-medium", hasDamage ? "text-orange-600" : "text-green-600")}>
                                        {hasDamage ? "To be assessed" : "None"}
                                    </span>
                                </div>

                                <Separator className="bg-gray-700" />

                                {isCompleted ? (
                                    <Button className="w-full" variant="outline" disabled>Return Completed</Button>
                                ) : (
                                    hasDamage ? (
                                        <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
                                            <DialogTrigger asChild>
                                                <Button className="w-full bg-[#FF5F00] hover:bg-[#E05200] text-white border-none">
                                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                                    Report Manager for Damage
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Confirm Damage Report</DialogTitle>
                                                    <DialogDescription>
                                                        You are about to report damage and submit this return for manager review. This will lock the return.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <div className="py-4">
                                                    <p className="font-medium mb-1">Summary:</p>
                                                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                                                        <li>{damages.length} damage entries</li>
                                                        <li>Odometer: {odo} km</li>
                                                        <li>Fuel: {fuel}%</li>
                                                    </ul>
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => setShowReportDialog(false)}>Cancel</Button>
                                                    <Button variant="destructive" onClick={handleReportDamage}>Confirm & Report</Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    ) : (
                                        <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
                                            <DialogTrigger asChild>
                                                <Button className="w-full bg-[#28A745] hover:bg-green-700 text-white border-none">
                                                    <FileCheck className="mr-2 h-4 w-4" />
                                                    Complete Return
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Complete Return</DialogTitle>
                                                    <DialogDescription>
                                                        Confirm that the vehicle is in good condition with NO new damage.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <div className="py-4">
                                                    <p className="font-medium mb-1">Summary:</p>
                                                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                                                        <li>No new damage</li>
                                                        <li>Odometer: {odo} km</li>
                                                        <li>Fuel: {fuel}%</li>
                                                    </ul>
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>Cancel</Button>
                                                    <Button className="bg-green-600 hover:bg-green-700" onClick={handleCompleteReturn}>Confirm Complete</Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    )
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
