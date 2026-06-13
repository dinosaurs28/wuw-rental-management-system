import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  MoreHorizontal,
  Fuel,
  Settings2,
  Coins,
  ChevronDown,
  ArrowLeft,
  Car,
  Receipt,
} from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  fetchVehicleCategories,
  deleteVehicle,
  type ManagerVehicle,
  type Category,
} from "@/services/vehicle.service";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PricingSlabList } from "@/components/manager/pricing/PricingSlabList";
import { toast } from "sonner";

export const ManagerVehiclesPage = () => {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<ManagerVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categories, setCategories] = useState<Category[]>([]);

  const [activeTab, setActiveTab] = useState("vehicles");

  useEffect(() => {
    fetchVehicleCategories().then(setCategories);
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [searchTerm, categoryFilter]);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      const response = await fetchManagerVehicles({
        limit: 100,
        search: searchTerm || undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
      });
      setVehicles(response.data);
    } catch (error) {
      toast.error("Failed to load vehicles");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredVehicles = vehicles;

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

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div>
            <Breadcrumb className="mb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/manager/dashboard">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {activeTab === "vehicles" ? "Vehicles & Pricing" : "Pricing Rules"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            {activeTab === "pricing" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("vehicles")}
                className="-ml-2 mb-2 text-neutral-600 hover:text-neutral-900"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Fleet
              </Button>
            )}

            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900">
              {activeTab === "vehicles" ? "Fleet Management" : "Pricing Rules"}
            </h1>
            <p className="text-neutral-500 mt-1 text-sm">
              {activeTab === "vehicles"
                ? "Manage your vehicles, availability, and fleet settings."
                : "Configure pricing slabs and rental rate structures."}
            </p>
          </div>

          {activeTab === "vehicles" && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2 h-10">
                    <Settings2 className="w-4 h-4" />
                    Operations
                    <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs text-neutral-500 font-normal">
                    Configuration
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => navigate("/manager/payment/discounts?tab=config", { state: { scrollTo: "duration-discount-slabs" } })}
                  >
                    <Coins className="w-4 h-4 text-neutral-500" />
                    Pricing Rules
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => navigate("/manager/gst-rules")}
                  >
                    <Receipt className="w-4 h-4 text-neutral-500" />
                    GST Rules
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-10"
                onClick={() => navigate("/manager/vehicles/add")}
              >
                <Plus className="w-4 h-4" />
                Add Vehicle
              </Button>
            </div>
          )}
        </div>

        {/* Vehicles View */}
        {activeTab === "vehicles" && (
          <>
            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <Input
                  placeholder="Search by make, model, or plate..."
                  className="pl-10 h-11 bg-white"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-52 h-11 bg-white">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.publicId} value={cat.publicId}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Results count */}
            {!isLoading && filteredVehicles.length > 0 && (
              <p className="text-sm text-neutral-500 mb-4">
                {filteredVehicles.length}{" "}
                {filteredVehicles.length === 1 ? "vehicle" : "vehicles"}
              </p>
            )}

            {/* Content */}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-3" />
                <p className="text-sm text-neutral-400">Loading fleet...</p>
              </div>
            ) : filteredVehicles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 bg-white rounded-xl border border-dashed border-neutral-200">
                <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
                  <Car className="w-8 h-8 text-neutral-300" />
                </div>
                <p className="text-neutral-700 font-medium mb-1">No vehicles found</p>
                <p className="text-sm text-neutral-400 mb-4">
                  {searchTerm || categoryFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Add your first vehicle to get started"}
                </p>
                <Button
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
                  onClick={() => navigate("/manager/vehicles/add")}
                >
                  <Plus className="w-4 h-4" />
                  Add Vehicle
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredVehicles.map((vehicle) => (
                  <div
                    key={vehicle.publicId}
                    className="bg-white rounded-xl border border-neutral-200 overflow-hidden hover:border-neutral-300 hover:shadow-md transition-all duration-200 group"
                  >
                    {/* Vehicle Image */}
                    <div className="relative h-44 bg-gradient-to-br from-neutral-100 to-neutral-50 overflow-hidden">
                      {vehicle.images?.[0]?.file?.url ? (
                        <img
                          src={vehicle.images[0].file.url}
                          alt={`${vehicle.make} ${vehicle.model}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <Car className="w-10 h-10 text-neutral-300" />
                          <span className="text-xs text-neutral-300">No image</span>
                        </div>
                      )}

                      {/* Status badge */}
                      <div className="absolute top-2.5 left-2.5">
                        <Badge
                          className={`${getStatusBadgeStyles(vehicle.status || "")} shadow-sm text-[11px] px-2 py-0.5`}
                        >
                          {vehicle.status || "Unknown"}
                        </Badge>
                      </div>

                      {/* Actions */}
                      <div className="absolute top-2 right-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-7 w-7 bg-white/90 backdrop-blur-sm hover:bg-white shadow-sm border border-white/60"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-xs">Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(`/manager/vehicles/edit/${vehicle.publicId}`)
                              }
                            >
                              Edit Vehicle
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
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
                      </div>
                    </div>

                    {/* Vehicle Info */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-neutral-900 leading-snug truncate text-[15px]">
                            {vehicle.make} {vehicle.model}
                          </h3>
                          <p className="text-xs text-neutral-400 mt-0.5 font-mono tracking-wide">
                            {vehicle.regNo || "—"}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-base font-bold text-neutral-900 leading-none">
                            ₹{vehicle.customPricing?.price24Hour}
                          </p>
                          <p className="text-[10px] text-neutral-400 mt-0.5">/day</p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                        <Badge
                          variant="secondary"
                          className="font-normal text-[11px] text-neutral-600"
                        >
                          {vehicle.category?.name || "Uncategorized"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-neutral-500 hover:text-neutral-900 -mr-1 gap-1"
                          onClick={() =>
                            navigate(`/manager/vehicles/edit/${vehicle.publicId}`)
                          }
                        >
                          <Settings2 className="w-3 h-3" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Pricing View */}
        {activeTab === "pricing" && (
          <div className="mt-2">
            <PricingSlabList />
          </div>
        )}
      </div>
    </ManagerLayout>
  );
};
