import { useParams, useNavigate } from "react-router-dom";
import { VehicleHistoryReport } from "@/components/admin/reports/VehicleHistoryReport";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const VehicleHistoryPage = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  if (!vehicleId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Invalid Vehicle ID
        </h2>
        <p className="text-gray-600 mb-4">
          No vehicle ID was provided in the URL.
        </p>
        <Button onClick={() => navigate("/admin/reports")} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Reports
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="p-4 md:p-6">
          <Button
            onClick={() => navigate(-1)}
            variant="ghost"
            size="sm"
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <VehicleHistoryReport vehicleId={vehicleId} />
        </div>
      </div>
    </div>
  );
};
