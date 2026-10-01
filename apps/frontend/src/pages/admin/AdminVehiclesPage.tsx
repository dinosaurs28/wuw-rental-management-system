import { useEffect, useMemo, useState } from "react";
import { Car, Loader2, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UseCaseBadges, UseCaseFilterChips } from "@/components/vehicles/UseCaseChips";
import { adminService } from "@/services/admin.service";
import type { VehicleUseCase } from "@/services/vehicle.service";

interface AdminVehicleRow {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  status: string;
  useCases?: VehicleUseCase[];
  category?: { name: string } | null;
  branch?: { name: string } | null;
}

export const AdminVehiclesPage = () => {
  const [vehicles, setVehicles] = useState<AdminVehicleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminVehicleRow | null>(null);
  const [draft, setDraft] = useState<VehicleUseCase[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminService.getAllVehicles();
        setVehicles(res.data ?? []);
      } catch {
        toast.error("Failed to load vehicles");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      `${v.make} ${v.model} ${v.regNo} ${v.branch?.name ?? ""} ${v.category?.name ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [vehicles, search]);

  const openEditor = (v: AdminVehicleRow) => {
    setEditing(v);
    setDraft(v.useCases ?? []);
  };

  const handleSave = async () => {
    if (!editing) return;
    setIsSaving(true);
    try {
      const result = await adminService.updateVehicleUseCases(editing.publicId, draft);
      setVehicles((prev) =>
        prev.map((v) =>
          v.publicId === editing.publicId
            ? { ...v, useCases: result.useCases as VehicleUseCase[] }
            : v,
        ),
      );
      toast.success("Trip types updated");
      setEditing(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update trip types");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Car className="h-7 w-7 text-orange-500" />
          Vehicles
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Tag vehicles with trip types (Highway, Hill Station, Long Drive) so customers can filter by them.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-base font-semibold">
            All vehicles ({filtered.length})
          </CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search make, model, reg no, branch..."
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-12">No vehicles found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reg No</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Trip types</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => (
                  <TableRow key={v.publicId}>
                    <TableCell className="font-mono text-sm">{v.regNo}</TableCell>
                    <TableCell className="font-medium">
                      {v.make} {v.model}
                    </TableCell>
                    <TableCell className="text-sm">{v.category?.name ?? "-"}</TableCell>
                    <TableCell className="text-sm">{v.branch?.name ?? "-"}</TableCell>
                    <TableCell>
                      {v.useCases && v.useCases.length > 0 ? (
                        <UseCaseBadges useCases={v.useCases} />
                      ) : (
                        <span className="text-xs text-gray-400">Untagged</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit trip types for ${v.regNo}`}
                        onClick={() => openEditor(v)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && !isSaving && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit trip types</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.make} ${editing.model} (${editing.regNo})` : ""}
            </DialogDescription>
          </DialogHeader>
          <UseCaseFilterChips value={draft} onChange={setDraft} />
          <p className="text-xs text-gray-500">
            Select none to remove all tags. Tag every unit of a model the same way, since customers book any unit of a model.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
