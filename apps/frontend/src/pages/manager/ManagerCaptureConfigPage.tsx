import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, GripVertical, X, Camera } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import apiClient from "@/lib/axios";

interface CaptureField {
  name: string;
  required: boolean;
}

interface CaptureConfig {
  publicId: string;
  category: { publicId: string; name: string };
  fields: CaptureField[];
}

interface VehicleCategory {
  publicId: string;
  name: string;
}

// ---- API helpers ----
const fetchConfigs = async (): Promise<CaptureConfig[]> => {
  const res = await apiClient.get("/branchManager/capture-configs");
  return res.data.configs;
};

const fetchCategories = async (): Promise<VehicleCategory[]> => {
  const res = await apiClient.get("/branchManager/dashboard/categories");
  return res.data.data ?? res.data.categories ?? res.data;
};

export default function ManagerCaptureConfigPage() {
  const queryClient = useQueryClient();

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["capture-configs"],
    queryFn: fetchConfigs,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: fetchCategories,
  });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CaptureConfig | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [fields, setFields] = useState<CaptureField[]>([{ name: "", required: true }]);

  // Create
  const createMutation = useMutation({
    mutationFn: (data: { categoryId: string; fields: CaptureField[] }) =>
      apiClient.post("/branchManager/capture-configs", data),
    onSuccess: () => {
      toast.success("Capture config created");
      queryClient.invalidateQueries({ queryKey: ["capture-configs"] });
      closeDialog();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to create"),
  });

  // Update
  const updateMutation = useMutation({
    mutationFn: ({ publicId, fields }: { publicId: string; fields: CaptureField[] }) =>
      apiClient.put(`/branchManager/capture-configs/${publicId}`, { fields }),
    onSuccess: () => {
      toast.success("Capture config updated");
      queryClient.invalidateQueries({ queryKey: ["capture-configs"] });
      closeDialog();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to update"),
  });

  // Delete
  const deleteMutation = useMutation({
    mutationFn: (publicId: string) =>
      apiClient.delete(`/branchManager/capture-configs/${publicId}`),
    onSuccess: () => {
      toast.success("Capture config deleted");
      queryClient.invalidateQueries({ queryKey: ["capture-configs"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to delete"),
  });

  // ---- Dialog helpers ----
  const openCreate = () => {
    setEditingConfig(null);
    setSelectedCategoryId("");
    setFields([{ name: "", required: true }]);
    setDialogOpen(true);
  };

  const openEdit = (config: CaptureConfig) => {
    setEditingConfig(config);
    setSelectedCategoryId(config.category.publicId);
    setFields(config.fields.map((f) => ({ ...f })));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingConfig(null);
    setSelectedCategoryId("");
    setFields([{ name: "", required: true }]);
  };

  const addField = () => setFields((prev) => [...prev, { name: "", required: false }]);

  const removeField = (i: number) =>
    setFields((prev) => prev.filter((_, idx) => idx !== i));

  const updateField = (i: number, key: keyof CaptureField, value: string | boolean) =>
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));

  const handleSave = () => {
    const cleaned = fields.filter((f) => f.name.trim());
    if (!cleaned.length) {
      toast.error("Add at least one field with a name");
      return;
    }

    if (editingConfig) {
      updateMutation.mutate({ publicId: editingConfig.publicId, fields: cleaned });
    } else {
      if (!selectedCategoryId) {
        toast.error("Select a vehicle category");
        return;
      }
      createMutation.mutate({ categoryId: selectedCategoryId, fields: cleaned });
    }
  };

  // Categories that don't have a config yet (for the create dialog)
  const configuredCategoryIds = new Set(configs.map((c) => c.category.publicId));
  const availableCategories = categories.filter((c) => !configuredCategoryIds.has(c.publicId));

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <ManagerLayout>
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Photo Capture Config</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure which sides/angles employees must photograph per vehicle category at pickup.
            </p>
          </div>
          <Button
            className="bg-[#FF5F00] hover:bg-[#e65600]"
            onClick={openCreate}
            disabled={availableCategories.length === 0}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Config
          </Button>
        </div>

        {/* Config list */}
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : configs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Camera className="h-10 w-10 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground text-sm">No capture configs yet.</p>
              <Button variant="outline" onClick={openCreate} disabled={availableCategories.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Add your first config
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {configs.map((config) => (
              <Card key={config.publicId} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{config.category.name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {config.fields.length} capture field{config.fields.length !== 1 ? "s" : ""}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(config)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50 border-red-200"
                        onClick={() => deleteMutation.mutate(config.publicId)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {config.fields.map((field, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className={field.required ? "border-orange-300 bg-orange-50 text-orange-700" : ""}
                      >
                        {field.name}
                        {field.required && <span className="ml-1 text-orange-500">*</span>}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    <span className="text-orange-500">*</span> = required at pickup
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingConfig ? "Edit Capture Config" : "New Capture Config"}</DialogTitle>
              <DialogDescription>
                Define which sides / angles employees should photograph at vehicle pickup.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Category selector (create only) */}
              {!editingConfig && (
                <div className="space-y-1.5">
                  <Label>Vehicle Category</Label>
                  <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCategories.map((c) => (
                        <SelectItem key={c.publicId} value={c.publicId}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Fields */}
              <div className="space-y-2">
                <Label>Capture Fields</Label>
                <div className="space-y-2">
                  {fields.map((field, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Input
                        placeholder={`e.g. Front View`}
                        value={field.name}
                        onChange={(e) => updateField(i, "name", e.target.value)}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Checkbox
                          id={`req-${i}`}
                          checked={field.required}
                          onCheckedChange={(c) => updateField(i, "required", !!c)}
                        />
                        <Label htmlFor={`req-${i}`} className="text-xs cursor-pointer">
                          Required
                        </Label>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                        onClick={() => removeField(i)}
                        disabled={fields.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addField} className="mt-1">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Field
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                className="bg-[#FF5F00] hover:bg-[#e65600]"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? "Saving..." : "Save Config"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ManagerLayout>
  );
}
