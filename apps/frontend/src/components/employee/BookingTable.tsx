
import { format } from "date-fns";
import type { EmployeeBooking } from "@/services/booking.service";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Phone, Car } from "lucide-react";

interface BookingTableProps {
    bookings: EmployeeBooking[];
    filterType: "PICKUP" | "RETURN";
    onAction: (bookingId: string) => void;
    isLoading?: boolean;
}

export function BookingTable({ bookings, filterType, onAction, isLoading }: BookingTableProps) {

    const getActionLabel = () => filterType === "PICKUP" ? "Approve Pickup" : "Approve Handover";

    // Status Badge Color Mapping
    const getStatusVariant = (status: string) => {
        switch (status) {
            case 'CONFIRMED': return 'default'; // Primary/Black
            case 'PICKED_UP': return 'secondary'; // Gray
            case 'COMPLETED': return 'outline';
            case 'CANCELLED': return 'destructive';
            default: return 'outline';
        }
    };

    // Status Text Mapping (Optional: Make it friendlier)
    const getStatusLabel = (status: string) => {
        if (status === 'CONFIRMED') return 'Ready for Pickup';
        if (status === 'PICKED_UP') return 'Active Rental';
        return status.replace('_', ' ');
    };

    if (isLoading) {
        return (
            <div className="w-full h-48 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (bookings.length === 0) {
        return (
            <div className="text-center py-16 bg-muted/10 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2">
                <Car className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-muted-foreground text-lg font-medium">No {filterType.toLowerCase()}s scheduled for this date.</p>
                <p className="text-sm text-muted-foreground">Try selecting a different date or filter.</p>
            </div>
        );
    }

    const MobileView = () => (
        <div className="grid gap-4 md:hidden">
            {bookings.map((booking) => (
                <Card key={booking.publicId} className="overflow-hidden shadow-sm border-muted">
                    <CardHeader className="pb-3 bg-muted/30 p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle className="text-sm font-bold font-mono text-muted-foreground">
                                    #{booking.publicId.slice(-6).toUpperCase()}
                                </CardTitle>
                                <CardDescription className="text-xs font-medium text-foreground mt-1">
                                    {format(new Date(booking.startAt), "EEE, MMM dd")} - {format(new Date(booking.endAt), "EEE, MMM dd")}
                                </CardDescription>
                            </div>
                            <Badge variant={getStatusVariant(booking.status)} className="uppercase text-[10px] tracking-wider">
                                {getStatusLabel(booking.status)}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-4 grid gap-4">
                        <div className="flex items-center gap-3">
                            <AvatarFallback name={booking.customer.user.name} />
                            <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-sm truncate">{booking.customer.user.name}</h4>
                                <div className="flex items-center text-xs text-muted-foreground mt-0.5">
                                    <Phone className="h-3 w-3 mr-1.5" />
                                    {booking.customer.user.phone || "N/A"}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 p-3 bg-muted/20 rounded-lg border border-muted/50">
                            {/* Vehicle Image */}
                            <div className="h-12 w-16 bg-background rounded border overflow-hidden shrink-0">
                                {booking.items[0]?.vehicle.images?.[0]?.file?.url ? (
                                    <img
                                        src={booking.items[0].vehicle.images[0].file.url}
                                        alt="Vehicle"
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center bg-muted">
                                        <Car className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate">
                                    {booking.items[0]?.vehicle.make} {booking.items[0]?.vehicle.model}
                                </p>
                                <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                    {booking.items[0]?.vehicle.regNo}
                                </p>
                            </div>
                        </div>

                        <Button
                            className="w-full font-semibold shadow-sm"
                            size="lg"
                            onClick={() => onAction(booking.publicId)}
                            variant={filterType === "PICKUP" ? "default" : "destructive"} // Orange/Red for return?
                        >
                            {getActionLabel()}
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>
    );

    const DesktopView = () => (
        <div className="hidden md:block rounded-xl border bg-card shadow-sm overflow-hidden">
            <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[120px] font-semibold">Booking ID</TableHead>
                        <TableHead className="w-[250px] font-semibold">Customer</TableHead>
                        <TableHead className="w-[250px] font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold">Pickup</TableHead>
                        <TableHead className="font-semibold">Return</TableHead>
                        <TableHead className="w-[140px] font-semibold">Status</TableHead>
                        <TableHead className="text-right font-semibold">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {bookings.map((booking) => (
                        <TableRow key={booking.publicId} className="hover:bg-muted/10 h-16">
                            <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                                <span className={cn(
                                    "px-2 py-1 rounded-md bg-muted/50 border",
                                    "group-hover:bg-background transition-colors"
                                )}>
                                    #{booking.publicId.slice(-6).toUpperCase()}
                                </span>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <AvatarFallback name={booking.customer.user.name} />
                                    <div className="flex flex-col">
                                        <span className="font-medium text-sm leading-none mb-1">{booking.customer.user.name}</span>
                                        <span className="text-xs text-muted-foreground flex items-center">
                                            <Phone className="h-3 w-3 mr-1" />
                                            {booking.customer.user.phone || "--"}
                                        </span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-14 bg-muted/30 rounded border overflow-hidden shrink-0">
                                        {booking.items[0]?.vehicle.images?.[0]?.file?.url ? (
                                            <img
                                                src={booking.items[0].vehicle.images[0].file.url}
                                                alt="Vehicle"
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center">
                                                <Car className="h-4 w-4 text-muted-foreground/50" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-medium text-sm leading-none mb-1">
                                            {booking.items[0]?.vehicle.make} {booking.items[0]?.vehicle.model}
                                        </span>
                                        <span className="text-xs font-mono text-muted-foreground">
                                            {booking.items[0]?.vehicle.regNo}
                                        </span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-sm">
                                <div className="flex flex-col">
                                    <span className="font-medium">{format(new Date(booking.startAt), "MMM dd")}</span>
                                    <span className="text-xs text-muted-foreground">{format(new Date(booking.startAt), "h:mm a")}</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-sm">
                                <div className="flex flex-col">
                                    <span className="font-medium">{format(new Date(booking.endAt), "MMM dd")}</span>
                                    <span className="text-xs text-muted-foreground">{format(new Date(booking.endAt), "h:mm a")}</span>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge variant={getStatusVariant(booking.status)} className="font-medium">
                                    {getStatusLabel(booking.status)}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                                <Button
                                    size="sm"
                                    onClick={() => onAction(booking.publicId)}
                                    className={cn(
                                        "font-medium shadow-sm h-8",
                                        filterType === "RETURN"
                                            ? "bg-orange-600 hover:bg-orange-700 text-white"
                                            : ""
                                    )}
                                >
                                    {getActionLabel()}
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );

    return (
        <>
            <MobileView />
            <DesktopView />
        </>
    );
}

// Helper Components

function AvatarFallback({ name }: { name: string }) {
    // Generate clearer initials
    const initials = name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    // Random-ish color based on name length for visual variety (consistent for same name)
    const colors = ["bg-blue-100 text-blue-700", "bg-green-100 text-green-700", "bg-purple-100 text-purple-700", "bg-orange-100 text-orange-700"];
    const colorClass = colors[name.length % colors.length];

    return (
        <div className={cn("h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 select-none", colorClass)}>
            {initials}
        </div>
    )
}
