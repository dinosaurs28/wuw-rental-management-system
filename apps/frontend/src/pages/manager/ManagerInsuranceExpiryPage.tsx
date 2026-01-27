
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, AlertTriangle, Calendar, Settings2 } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { fetchInsuranceExpiryReport, type InsuranceExpiryReportItem } from "@/services/vehicle.service";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";

export const ManagerInsuranceExpiryPage = () => {
    const navigate = useNavigate();
    const [reports, setReports] = useState<InsuranceExpiryReportItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        const loadReport = async () => {
            setIsLoading(true);
            try {
                const data = await fetchInsuranceExpiryReport(searchTerm);
                setReports(data);
            } catch (error) {
                toast.error("Failed to load insurance data");
            } finally {
                setIsLoading(false);
            }
        };

        // Debounce search
        const timer = setTimeout(() => {
            loadReport();
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm]);

    const getExpiryStatus = (dateString: string) => {
        const days = differenceInDays(new Date(dateString), new Date());
        if (days < 0) return { label: "Expired", color: "bg-red-100 text-red-700 border-red-200" };
        if (days <= 30) return { label: "Expiring Soon", color: "bg-orange-100 text-orange-700 border-orange-200" };
        return { label: "Valid", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    };

    return (
        <ManagerLayout>
            <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
                <div className="mb-8">
                    <Breadcrumb className="mb-4">
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/manager/vehicles">Vehicles</BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>Insurance Alerts</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="icon" onClick={() => navigate("/manager/vehicles")}>
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
                                    Insurance Alerts
                                </h1>
                                <p className="text-neutral-500 mt-1">Track vehicle insurance expirations.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-lg border shadow-sm mb-6">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                        <Input
                            placeholder="Search by vehicle or policy number..."
                            className="pl-10 h-12"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                    </div>
                ) : reports.length === 0 ? (
                    <div className="text-center py-20 bg-neutral-50 rounded-lg border border-dashed">
                        <p className="text-neutral-500">No insurance records found matching your criteria.</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table */}
                        <div className="hidden md:block bg-white rounded-lg border shadow-sm overflow-hidden">
                            <Table>
                                <TableHeader className="bg-neutral-50">
                                    <TableRow>
                                        <TableHead>Vehicle</TableHead>
                                        <TableHead>Policy Number</TableHead>
                                        <TableHead>Provider</TableHead>
                                        <TableHead>Expiry Date</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="w-[80px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reports.map((item) => {
                                        const status = getExpiryStatus(item.expiryDate);
                                        return (
                                            <TableRow key={item.publicId}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-neutral-100 rounded overflow-hidden flex-shrink-0">
                                                            {item.thumbnail ? (
                                                                <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-neutral-400">
                                                                    <AlertTriangle className="w-5 h-5" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-neutral-900">{item.vehicleName}</p>
                                                            <p className="text-xs text-neutral-500">{item.regNo}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">{item.policyNumber}</TableCell>
                                                <TableCell>{item.provider}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-neutral-600">
                                                        <Calendar className="w-4 h-4" />
                                                        <span>{format(new Date(item.expiryDate), "MMM dd, yyyy")}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={`${status.color} shadow-none`}>
                                                        {status.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => navigate(`/manager/vehicles/edit/${item.publicId}`)}
                                                        title="Update Vehicle Details"
                                                    >
                                                        <Settings2 className="w-4 h-4 text-neutral-500" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Mobile List */}
                        <div className="md:hidden space-y-4">
                            {reports.map((item) => {
                                const status = getExpiryStatus(item.expiryDate);
                                return (
                                    <div key={item.publicId} className="bg-white p-4 rounded-lg border shadow-sm">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 bg-neutral-100 rounded overflow-hidden flex-shrink-0">
                                                    {item.thumbnail ? (
                                                        <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-neutral-400">
                                                            <AlertTriangle className="w-6 h-6" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-neutral-900">{item.vehicleName}</p>
                                                    <p className="text-xs text-neutral-500">{item.regNo}</p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-12 px-4"
                                                onClick={() => navigate(`/manager/vehicles/edit/${item.publicId}`)}
                                            >
                                                Update
                                            </Button>
                                        </div>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Policy:</span>
                                                <span className="font-medium text-neutral-900">{item.policyNumber}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Expiry:</span>
                                                <span className="font-medium text-neutral-900">
                                                    {format(new Date(item.expiryDate), "MMM dd, yyyy")}
                                                </span>
                                            </div>
                                            <div className="pt-2">
                                                <Badge className={`w-fit ${status.color} shadow-none`}>
                                                    {status.label}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </ManagerLayout>
    );
};
