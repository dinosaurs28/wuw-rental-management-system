import { useState } from "react";
import { AxiosError } from "axios";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { branchEmployeeService } from "@/services/branchEmployee.service";

const createEmployeeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
});

interface CreateEmployeeDialogProps {
  onSuccess: () => void;
}

interface CreatedCredentials {
  email: string;
  tempPassword: string;
}

function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: CreatedCredentials;
  onClose: () => void;
}) {
  const [copiedPassword, setCopiedPassword] = useState(false);

  const copyPassword = () => {
    navigator.clipboard.writeText(credentials.tempPassword);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
  };

  return (
    <DialogContent className="sm:max-w-[400px]">
      <DialogHeader>
        <DialogTitle>Employee Created</DialogTitle>
        <DialogDescription>
          Share these login credentials with the employee. The password is
          temporary — they should change it after first login.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-neutral-700">Login Email</p>
          <p className="text-sm font-mono bg-neutral-100 rounded px-3 py-2 text-neutral-900">
            {credentials.email}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-neutral-700">
            Temporary Password
          </p>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-mono bg-neutral-100 rounded px-3 py-2 text-neutral-900 tracking-wider">
              {credentials.tempPassword}
            </p>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={copyPassword}
            >
              {copiedPassword ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={onClose}
          className="bg-orange-600 hover:bg-orange-700 w-full"
        >
          Done
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function CreateEmployeeDialog({ onSuccess }: CreateEmployeeDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [createdCredentials, setCreatedCredentials] =
    useState<CreatedCredentials | null>(null);

  const form = useForm<z.infer<typeof createEmployeeSchema>>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      name: "",
      phone: "",
    },
  });

  async function onSubmit(values: z.infer<typeof createEmployeeSchema>) {
    try {
      setIsLoading(true);
      const result = await branchEmployeeService.create(values);
      form.reset();
      setCreatedCredentials({
        email: result.data.email,
        tempPassword: result.tempPassword,
      });
      onSuccess();
    } catch (error) {
      console.error(error);
      if (error instanceof AxiosError) {
        toast.error(
          error.response?.data?.message || "Failed to create employee",
        );
      } else {
        toast.error("Failed to create employee");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const handleClose = () => {
    setCreatedCredentials(null);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) handleClose();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-orange-600 hover:bg-orange-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Add Employee
        </Button>
      </DialogTrigger>

      {createdCredentials ? (
        <CredentialsDialog
          credentials={createdCredentials}
          onClose={handleClose}
        />
      ) : (
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>
              Enter the employee's details. A temporary password will be
              generated for their first login.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create Employee
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      )}
    </Dialog>
  );
}
