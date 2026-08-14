import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { resetPasswordSchema } from "@repo/schemas";
import { employeeService } from "@/services/employee.service";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff } from "lucide-react";

type ResetPasswordFormInput = Omit<z.infer<typeof resetPasswordSchema>, "token">;

export default function EmployeeResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(resetPasswordSchema.omit({ token: true })),
    defaultValues: { password: "" },
  });

  async function onSubmit(values: ResetPasswordFormInput) {
    setIsLoading(true);
    try {
      const response = await employeeService.resetPassword(
        token ?? "",
        values.password,
      );
      toast.success(response.message);
      navigate("/employee/sign-in");
    } catch (error: any) {
      toast.error("Could not reset password", {
        description: error.response?.data?.message || "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2">
      <div className="hidden lg:block relative h-full w-full bg-zinc-800 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=2694&auto=format&fit=crop')] bg-cover bg-center opacity-50" />
        <div className="relative z-20 flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2 font-medium text-lg">
            <div className="h-6 w-6 rounded-md bg-white text-black flex items-center justify-center font-bold">
              V
            </div>
            WUW Employee Portal
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              Manage the world's finest fleet.
            </h1>
            <p className="text-lg text-zinc-300">
              Secure access for authorized personnel only.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="mx-auto w-full max-w-[400px] space-y-6">
          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight">
              Set a new password
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder="••••••••"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          disabled={isLoading}
                          className="pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Resetting..." : "Reset password"}
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/employee/sign-in"
              className="underline underline-offset-4 hover:text-primary"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
