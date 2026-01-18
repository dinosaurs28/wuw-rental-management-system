
import { useParams } from "react-router-dom";
import { DashboardNavbar } from "@/components/employee/DashboardNavbar";

export default function ReturnProcessPage() {
    const { bookingId } = useParams();

    return (
        <div className="min-h-screen bg-gray-50/50">
            <DashboardNavbar />
            <div className="container py-10 flex flex-col items-center justify-center">
                <div className="bg-white p-8 rounded-lg shadow-sm border text-center max-w-md w-full">
                    <h1 className="text-2xl font-bold mb-2">Return Process</h1>
                    <p className="text-muted-foreground mb-6">Booking ID: <span className="font-mono font-medium text-foreground">{bookingId}</span></p>
                    <div className="p-4 bg-blue-50 text-blue-700 rounded-md text-sm border border-blue-200">
                        This workflow is under construction.
                    </div>
                </div>
            </div>
        </div>
    );
}
