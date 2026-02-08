import { useNavigate } from 'react-router-dom';
import { VehicleAvailabilityReport } from '@/components/admin/reports/VehicleAvailabilityReport';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export const VehicleAvailabilityPage = () => {
    const navigate = useNavigate();

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
                    <VehicleAvailabilityReport />
                </div>
            </div>
        </div>
    );
};
