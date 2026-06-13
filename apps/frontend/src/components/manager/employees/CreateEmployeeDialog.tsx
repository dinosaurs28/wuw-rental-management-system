import { useState } from "react";
import { AxiosError } from "axios";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, UserPlus, Eye, EyeOff, Phone, Lock, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
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
    password: z.string().min(8, "Password must be at least 8 characters"),
});

interface CreateEmployeeDialogProps {
    onSuccess: () => void;
}

export function CreateEmployeeDialog({ onSuccess }: CreateEmployeeDialogProps) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const form = useForm<z.infer<typeof createEmployeeSchema>>({
        resolver: zodResolver(createEmployeeSchema),
        defaultValues: {
            name: "",
            phone: "",
            password: "",
        },
    });

    async function onSubmit(values: z.infer<typeof createEmployeeSchema>) {
        try {
            setIsLoading(true);
            await branchEmployeeService.create(values);
            toast.success("Employee created successfully");
            setOpen(false);
            form.reset();
            onSuccess();
        } catch (error) {
            console.error(error);
            if (error instanceof AxiosError) {
                toast.error(error.response?.data?.message || "Failed to create employee");
            } else {
                toast.error("Failed to create employee");
            }
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { form.reset(); setShowPassword(false); } }}>
            <DialogTrigger asChild>
                <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2 h-11">
                    <Plus className="w-4 h-4" />
                    Add Employee
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden">
                {/* Dialog header */}
                <div className="px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                            <UserPlus className="w-5 h-5 text-orange-600" />
                        </div>
                        <DialogHeader className="space-y-0.5">
                            <DialogTitle className="text-neutral-900 text-[15px] font-semibold">Add New Employee</DialogTitle>
                            <p className="text-xs text-neutral-500">Create a staff account for your branch.</p>
                        </DialogHeader>
                    </div>
                </div>

                <div className="px-6 py-5">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-neutral-700">Full Name</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                                                <Input
                                                    placeholder="e.g. Ravi Kumar"
                                                    className="pl-9 h-11"
                                                    {...field}
                                                />
                                            </div>
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
                                        <FormLabel className="text-neutral-700">Phone Number</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                                                <Input
                                                    placeholder="e.g. 9876543210"
                                                    className="pl-9 h-11"
                                                    {...field}
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-neutral-700">Password</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                                                <Input
                                                    type={showPassword ? "text" : "password"}
                                                    placeholder="Min. 8 characters"
                                                    className="pl-9 pr-10 h-11"
                                                    {...field}
                                                />
                                                <button
                                                    type="button"
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                                                    onClick={() => setShowPassword((p) => !p)}
                                                    tabIndex={-1}
                                                >
                                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-3 pt-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1 h-11"
                                    onClick={() => setOpen(false)}
                                    disabled={isLoading}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="flex-1 h-11 bg-orange-500 hover:bg-orange-600 text-white"
                                >
                                    {isLoading ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
                                    ) : (
                                        "Create Employee"
                                    )}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
