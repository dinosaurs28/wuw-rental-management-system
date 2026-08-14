import { useMutation } from "@tanstack/react-query";
import { authService } from "../services/auth.service";
import type {
  SignInInput,
  SignUpInput,
  OtpVerifyInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../services/auth.service";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { useAuthStore } from "@/store/auth.store";

export const useSignIn = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  return useMutation({
    mutationFn: (data: SignInInput) => authService.signIn(data),
    onSuccess: (response, _variables, _context) => {
      // Backend returns status 201 when email verification is needed
      // and status 200 when user is fully authenticated
      if (response.status === 201) {
        // Don't call login() here - user is not fully authenticated yet
        // The verifySession cookie is set by backend for OTP verification
        toast.info("Please verify your phone number");
        navigate("/auth/verify-otp");
      } else {
        // Only store user data when fully authenticated (status 200)
        toast.success("Signed in successfully!");
        if (response.data?.publicId) {
          login({
            id: response.data.publicId,
            email: response.data.email || "",
            name: response.data.name || "",
            role: response.data.role || "",
          });
        }
        const { hasBookingIntent, clearBookingIntent } = useAuthStore.getState();
        if (hasBookingIntent) {
          clearBookingIntent();
          navigate("/booking/review-confirm");
        } else {
          navigate("/my-bookings");
        }
      }
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || "Failed to sign in";
      toast.error(message);
    },
  });
};

export const useSignUp = () => {
  const navigate = useNavigate();
  // const signup = useAuthStore((state) => state.signup);

  return useMutation({
    mutationFn: (data: SignUpInput) => authService.signUp(data),
    onSuccess: () => {
      // Backend sets verifySession cookie if verification is needed
      toast.success("Account created!");
      if (Cookies.get("verifySession")) {
        navigate("/auth/verify-otp");
      }
      // If data.user exists and no verification needed, we could login.
    },
    onError: (error: any) => {
      const message =
        error.response?.data?.message || "Failed to create account";
      toast.error(message);
    },
  });
};

// Step 1 of the reset. Deliberately has no onSuccess toast: the backend answers
// identically for known and unknown emails, so the page shows one neutral
// "check your inbox" message instead of anything that could confirm an account.
export const useForgotPassword = () => {
  return useMutation({
    mutationFn: (data: ForgotPasswordInput) =>
      authService.forgotPassword(data),
    onError: (error: any) => {
      const message =
        error.response?.data?.message ||
        "Could not send the reset code. Please try again.";
      toast.error(message);
    },
  });
};

// Step 2. Navigation is left to the caller so it can show the success state
// before moving the user to sign-in.
export const useResetPassword = () => {
  return useMutation({
    mutationFn: (data: ResetPasswordInput) => authService.resetPassword(data),
    onError: (error: any) => {
      const message =
        error.response?.data?.message || "Could not reset the password";
      toast.error(message);
    },
  });
};

export const useSendOtp = () => {
  return useMutation({
    mutationFn: (phone: string) => authService.sendOtp(phone),
    onSuccess: () => {
      toast.success("OTP sent successfully!");
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || "Failed to send OTP";
      toast.error(message);
    },
  });
};

export const useVerifyOtp = () => {
  const navigate = useNavigate();
  const checkAuth = useAuthStore((state) => state.checkAuth);

  return useMutation({
    mutationFn: (data: OtpVerifyInput) => authService.verifyOtp(data),
    onSuccess: async () => {
      toast.success("Verification successful!");
      // Backend sets JWT cookie, removes verifySession
      // We should update the store. Since verifyOtp might not return full user, we can call checkAuth.
      await checkAuth();
      const { hasBookingIntent, clearBookingIntent } = useAuthStore.getState();
      if (hasBookingIntent) {
        clearBookingIntent();
        navigate("/booking/review-confirm");
      } else {
        navigate("/my-bookings");
      }
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || "Invalid OTP";
      toast.error(message);
    },
  });
};
