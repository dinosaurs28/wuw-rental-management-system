import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  type PricingDiscountSlab,
  pricingService,
} from "@/services/pricing.service";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { fetchVehicleCategories } from "@/services/vehicle.service";
import { useQuery } from "@tanstack/react-query";

const formSchema = z.object({
  categoryId: z.coerce.number().min(1, "Category is required"),
  days: z.coerce.number().min(1, "Days must be at least 1"),
  multiplier: z.coerce
    .number()
    .min(0.01)
    .max(1.0, "Multiplier must be between 0.01 and 1.0"),
});

type FormValues = z.infer<typeof formSchema>;

interface PricingSlabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSlab?: PricingDiscountSlab | null;
}

export function PricingSlabDialog({
  open,
  onOpenChange,
  editingSlab,
}: PricingSlabDialogProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      categoryId: 0,
      days: 7,
      multiplier: 0.1,
    },
  });

  // Fetch Categories
  const { data: categoriesResponse } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: fetchVehicleCategories,
    enabled: open,
  });

  const categories = categoriesResponse || [];

  useEffect(() => {
    if (open) {
      if (editingSlab) {
        form.reset({
          categoryId: editingSlab.categoryId,
          days: editingSlab.days,
          multiplier: Number(editingSlab.multiplier),
        });
      } else {
        form.reset({
          categoryId: 0,
          days: 7,
          multiplier: 0.1,
        });
      }
    }
  }, [open, editingSlab, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editingSlab) {
        await pricingService.updateDiscount(editingSlab.id, values);
      } else {
        await pricingService.createDiscount(values);
      }
    },
    onSuccess: () => {
      toast.success(editingSlab ? "Discount updated" : "Discount created");
      queryClient.invalidateQueries({ queryKey: ["pricing-discounts"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      console.error(error);
      toast.error(error.response?.data?.message || "Something went wrong");
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editingSlab ? "Edit Discount" : "Add New Discount"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehicle Category</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    // value={field.value?.toString()}
                    // Handle 0 or actual value
                    value={field.value ? field.value.toString() : ""}
                    disabled={!!editingSlab} // Maybe lock category on edit? Typically expected.
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((cat: any) => (
                        <SelectItem key={cat.id} value={cat.id.toString()}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum Days</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormDescription>
                    Apply this discount for bookings of this many days or more.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="multiplier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount Factor (0.01 - 1.0)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormDescription>
                    e.g., 0.10 = 10% Off. 0.20 = 20% Off.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {editingSlab ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
