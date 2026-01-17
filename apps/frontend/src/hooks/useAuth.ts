import { useMutation } from "@tanstack/react-query";
import { authService } from "../services/auth.service";
import type { SignInInput, SignUpInput, OtpVerifyInput } from "../services/auth.service";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { useAuthStore } from "@/store/auth.store";

export const useSignIn = () => {
    const navigate = useNavigate();
    const login = useAuthStore((state) => state.login);

    return useMutation({
        mutationFn: (data: SignInInput) => authService.signIn(data),
        onSuccess: (response) => {
            toast.success("Signed in successfully!");

            // Store user data in Zustand (nested in response.data)
            if (response.data?.publicId) {
                login({
                    id: response.data.publicId,
                    email: response.data.email || "",
                    name: response.data.name || "",
                    role: response.data.role || "",
                });
            }

            if (Cookies.get("verifySession")) {
                navigate("/auth/verify-otp");
            } else {
                navigate("/my-bookings");
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
            const message = error.response?.data?.message || "Failed to create account";
            toast.error(message);
        }
    })
}

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
            navigate("/my-bookings");
        },
        onError: (error: any) => {
            const message = error.response?.data?.message || "Invalid OTP";
            toast.error(message);
        },
    });
};
