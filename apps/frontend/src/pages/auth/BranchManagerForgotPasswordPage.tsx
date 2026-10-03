import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { forgotPasswordSchema } from "@repo/schemas";
import { branchManagerService } from "@/services/branch.service";
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
import SmsResetFlow from "@/components/auth/SmsResetFlow";
import { passwordResetService, type ResetChannels } from "@/services/passwordReset.service";

export default function BranchManagerForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [mode, setMode] = useState<"sms" | "email">("sms");
  const [channels, setChannels] = useState<ResetChannels | null>(null);

  useEffect(() => {
    passwordResetService.getChannels().then((c) => {
      setChannels(c);
      if (!c.sms) setMode("email");
    });
  }, []);

  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof forgotPasswordSchema>) {
    setIsLoading(true);
    try {
      const response = await branchManagerService.forgotPassword(values.email);
      toast.success(response.message);
      setSubmitted(true);
    } catch (error: any) {
      toast.error("Something went wrong", {
        description: error.response?.data?.message || "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2">
      <div className="hidden lg:block relative h-full w-full bg-zinc-800 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=2670&auto=format&fit=crop')] bg-cover bg-center opacity-50" />
        <div className="relative z-20 flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2 font-medium text-lg">
            <div className="h-6 w-6 rounded-md bg-white text-black flex items-center justify-center font-bold">
              V
            </div>
            WUW Manager
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              Oversee operations with precision.
            </h1>
            <p className="text-lg text-zinc-300">
              Advanced tools for branch management and analytics.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="mx-auto w-full max-w-[400px] space-y-6">
          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight">
              Reset your password
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "sms"
                ? "Enter your mobile number or email and we'll text you a 6-digit code."
                : "Enter your email address and we'll send you a link to reset your password."}
            </p>
          </div>

          {mode === "sms" ? (
            <SmsResetFlow
              scope="branchManager"
              variant="portal"
              signInPath="/branch-manager/sign-in"
              emailAvailable={channels?.email !== false}
              onUseEmail={() => setMode("email")}
            />
          ) : submitted ? (
            <p className="text-sm text-muted-foreground">
              If that email is registered, a reset link has been sent.
              Please check your inbox.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="manager@company.com"
                          type="email"
                          autoComplete="email"
                          disabled={isLoading}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Sending..." : "Send reset link"}
                </Button>
              </form>
            </Form>
          )}

          {mode === "email" && channels?.email === false && (
            <p className="text-center text-sm text-amber-600">
              Email reset is unavailable right now — use the SMS code.
            </p>
          )}
          {mode === "email" && channels?.sms !== false && (
            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => setMode("sms")}
                className="underline underline-offset-4 hover:text-primary"
              >
                Text me a code instead
              </button>
            </p>
          )}

          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/branch-manager/sign-in"
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
