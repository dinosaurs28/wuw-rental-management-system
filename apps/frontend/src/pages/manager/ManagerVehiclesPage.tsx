import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  MoreHorizontal,
  Fuel,
  Settings2,
  AlertTriangle,
  Coins,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  fetchManagerVehicles,
  deleteVehicle,
  type ManagerVehicle,
} from "@/services/vehicle.service";
import { PricingSlabList } from "@/components/manager/pricing/PricingSlabList";
import { toast } from "sonner";

export const ManagerVehiclesPage = () => {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<ManagerVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Default tab
  const [activeTab, setActiveTab] = useState("vehicles");

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      const response = await fetchManagerVehicles({ limit: 100 }); // Fetch all for now
      setVehicles(response.data);
    } catch (error) {
      toast.error("Failed to load vehicles");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredVehicles = vehicles.filter(
    (v) =>
      v.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.publicId.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200";
      case "MAINTENANCE":
        return "bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200";
      case "INACTIVE":
        return "bg-red-100 text-red-700 hover:bg-red-100 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 hover:bg-gray-100 border-gray-200";
    }
  };

  return (
    <ManagerLayout>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-8 pb-12">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/manager/dashboard">
                    Dashboard
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Vehicles & Pricing</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
              Fleet Management
            </h1>
            <p className="text-neutral-500 mt-1">
              Manage your fleet, pricing rules, and availability.
            </p>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="vehicles" className="flex items-center gap-2">
              <Fuel className="size-4" />
              Vehicles
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex items-center gap-2">
              <Coins className="size-4" />
              Pricing Rules
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vehicles" className="space-y-4">
            {/* Action Buttons for Vehicles Tab */}
            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto justify-end mb-4">
              <Button
                variant="outline"
                className="h-9 md:h-11 w-full sm:w-auto text-sm"
                onClick={() => navigate("/manager/deposit-rules")}
              >
                Deposit Rules
              </Button>
              <Button
                variant="outline"
                className="h-9 md:h-11 w-full sm:w-auto text-sm"
                onClick={() => navigate("/manager/insurance-expiry")}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Insurance Alerts
              </Button>
              <Button
                variant="outline"
                className="h-9 md:h-11 w-full sm:w-auto text-sm"
                onClick={() => navigate("/manager/gst-rules")}
              >
                GST Rules
              </Button>
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white h-9 md:h-11 w-full sm:w-auto text-sm"
                onClick={() => navigate("/manager/vehicles/add")}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Vehicle
              </Button>
            </div>

            {/* Filters & Search */}
            <div className="bg-white p-4 rounded-lg border shadow-sm mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <Input
                  placeholder="Search by make, model, or license plate..."
                  className="pl-10 h-12"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* Content */}
            {isLoading ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              </div>
            ) : filteredVehicles.length === 0 ? (
              <div className="text-center py-20 bg-neutral-50 rounded-lg border border-dashed">
                <p className="text-neutral-500">No vehicles found.</p>
                <Button
                  variant="link"
                  className="text-orange-500"
                  onClick={() => navigate("/manager/vehicles/add")}
                >
                  Add your first vehicle
                </Button>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block bg-white rounded-lg border shadow-sm overflow-hidden">
                  <Table>
                    <TableHeader className="bg-neutral-50">
                      <TableRow>
                        <TableHead className="w-[100px]">Image</TableHead>
                        <TableHead>Vehicle Info</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">
                          Daily Price
                        </TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVehicles.map((vehicle) => (
                        <TableRow key={vehicle.publicId}>
                          <TableCell>
                            <div className="w-16 h-12 bg-neutral-100 rounded overflow-hidden">
                              {vehicle.imageUrl?.[0]?.file?.url ? (
                                <img
                                  src={vehicle.imageUrl[0].file.url}
                                  alt={vehicle.model}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-400">
                                  <Fuel className="w-6 h-6" />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-neutral-900">
                                {vehicle.make} {vehicle.model}
                              </p>
                              <p className="text-xs text-neutral-500">
                                {vehicle.regNo || "N/A"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal">
                              {vehicle.category?.name || "N/A"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={`${getStatusBadgeStyles(vehicle.status || "")} shadow-none`}
                            >
                              {vehicle.status || "Unknown"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            ₹{vehicle.customPricing?.price24Hour}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    navigate(
                                      `/manager/vehicles/edit/${vehicle.publicId}`,
                                    )
                                  }
                                >
                                  Edit Vehicle
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={async () => {
                                    try {
                                      if (!confirm("Are you sure?")) return;
                                      await deleteVehicle(vehicle.publicId);
                                      toast.success("Vehicle deleted");
                                      loadVehicles();
                                    } catch (e) {
                                      toast.error("Failed to delete");
                                    }
                                  }}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                  {filteredVehicles.map((vehicle) => (
                    <div
                      key={vehicle.publicId}
                      className="bg-white p-4 rounded-lg border shadow-sm flex gap-4"
                    >
                      <div className="w-24 h-24 bg-neutral-100 rounded-lg overflow-hidden flex-shrink-0">
                        {vehicle.imageUrl?.[0]?.file?.url ? (
                          <img
                            src={vehicle.imageUrl[0].file.url}
                            alt={vehicle.model}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-400">
                            <Fuel className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-medium text-neutral-900 truncate">
                              {vehicle.make} {vehicle.model}
                            </h3>
                            <p className="text-sm text-neutral-500">
                              {vehicle.category?.name || "N/A"}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-2 -mt-2"
                            onClick={() =>
                              navigate(
                                `/manager/vehicles/edit/${vehicle.publicId}`,
                              )
                            }
                          >
                            <Settings2 className="w-4 h-4 text-neutral-500" />
                          </Button>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <Badge
                            className={`${getStatusBadgeStyles(vehicle.status || "")} shadow-none`}
                          >
                            {vehicle.status || "Unknown"}
                          </Badge>
                          <p className="font-semibold text-neutral-900">
                            ₹{vehicle.customPricing?.price24Hour}
                            <span className="text-xs text-neutral-500 font-normal">
                              /day
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="pricing">
            <PricingSlabList />
          </TabsContent>
        </Tabs>
      </div>
    </ManagerLayout>
  );
};
