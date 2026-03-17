import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Car, Search, FileText } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/axios";

interface Vehicle {
  id: string;
  publicId: string;
  regNo: string;
  make: string;
  model: string;
  category: { name: string };
  branch: { name: string };
  status: string;
}

export const VehicleReportsListPage = () => {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchVehicles();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredVehicles(vehicles);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = vehicles.filter(
        (v) =>
          v.regNo.toLowerCase().includes(query) ||
          v.make.toLowerCase().includes(query) ||
          v.model.toLowerCase().includes(query) ||
          v.category.name.toLowerCase().includes(query),
      );
      setFilteredVehicles(filtered);
    }
  }, [searchQuery, vehicles]);

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      // Assuming there's an endpoint to get all vehicles
      const response = await apiClient.get("/admin/dashboard/vehicles");
      setVehicles(response.data.data || []);
      setFilteredVehicles(response.data.data || []);
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      toast.error("Failed to load vehicles");
    } finally {
      setLoading(false);
    }
  };

  const handleViewHistory = (vehicleId: string) => {
    navigate(`/admin/reports/vehicle/${vehicleId}`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="h-8 w-8 text-orange-500" />
          Vehicle Reports
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Select a vehicle to view its complete history and performance metrics
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by registration, make, model, or category..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Vehicle Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredVehicles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Car className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">
              {searchQuery
                ? "No vehicles found matching your search"
                : "No vehicles available"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((vehicle) => (
            <Card
              key={vehicle.publicId}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handleViewHistory(vehicle.publicId)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Car className="h-5 w-5 text-orange-500" />
                  {vehicle.regNo}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-medium text-gray-900">
                  {vehicle.make} {vehicle.model}
                </p>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>{vehicle.category.name}</span>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                    {vehicle.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{vehicle.branch.name}</p>
                <Button
                  className="w-full mt-3"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewHistory(vehicle.publicId);
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View History
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
