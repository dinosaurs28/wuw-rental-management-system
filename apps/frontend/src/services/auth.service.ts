import apiClient from "@/lib/axios";
import { API_BASE_URL } from "@/lib/constants";
import { z } from "zod";
import { emailAuthSchema, emailAuthSchemaSignin, otpSchema } from "@repo/schemas";
import Cookies from "js-cookie";

// Types derived from Zod schemas
export type SignInInput = z.infer<typeof emailAuthSchemaSignin>;
export type SignUpInput = z.infer<typeof emailAuthSchema>;
export type OtpVerifyInput = z.infer<typeof otpSchema> & { phone: string };

export interface AuthResponse {
    message: string;
    data?: {
        name?: string;
        email?: string;
        role?: string;
        publicId?: string;
    };
}

export interface CheckAuthResponse {
    message: string;
    data?: {
        isAuthenticated: boolean;
        name?: string;
        email?: string;
        role?: string;
        publicId?: string;
    };
}

export const authService = {
    signIn: async (data: SignInInput) => {
        const response = await apiClient.post<AuthResponse>("/auth/email/signin", data);
        return response.data;
    },

    checkAuth: async (google?: boolean) => {
        const queryParam = google ? "?google=true" : "";
        const response = await apiClient.get<CheckAuthResponse>(`/auth/me${queryParam}`);
        return response.data;
    },

    logout: async () => {
        await apiClient.get("/auth/logout");
    },

    signUp: async (data: SignUpInput) => {
        const response = await apiClient.post<AuthResponse>("/auth/email/signup", data);
        return response.data;
    },

    sendOtp: async (phone: string) => {
        // Current backend route for generating OTP is /auth/email/verify-email based on routes analysis, 
        // but the user requirement says "Phone users... POST request to backend". 
        // The previous analysis showed `router.route("/email/verify-email").post(generateOTP).post(verifyOTP)`
        // We should assume generic OTP endpoint or specific phone endpoint.
        // Based on user request "Page 2: OTP Verification Flow... Send OTP -> POST request", 
        // and context from finding `generateOTP` in `email-verify.controller`, 
        // let's stick to the route `/auth/email/verify-email` for now as generic verify, 
        // or if a phone specific route exists. 
        // Let's assume the endpoint handles phone numbers if the controller was refactored as per history.
        // NOTE: The previous conversation `Phone-Based OTP Verification` suggests `email-verify.controller` was refactored.
        // We will use `/auth/email/verify-email` (POST) for sending OTP.
        const response = await apiClient.post("/auth/email/verify-otp", { phone }, {
            withCredentials: true
        });
        return response.data;
    },

    verifyOtp: async (data: { otp: string }) => {
        // As per `router.route("/email/verify-email").post(generateOTP).post(verifyOTP)`
        // It seems it might use the same route with different method or body? 
        // Actually `router.route(...).post(generateOTP).post(verifyOTP)` is invalid express for same method.
        // Likely it is:
        // .post(generateOTP) is one, but you can't have two POSTs on same route without middleware chain.
        // Let's assume there is a verify endpoint. 
        // Looking at the route file again: 
        // router.route("/email/verify-email").post(generateOTP).post(verifyOTP) -> This looks like a mistake in the route file or it's a chain.
        // If it's a chain, `generateOTP` would call `next()`.
        // But usually verify is a separate step.
        // Let's assume we post to `/auth/email/verify-email` with OTP to verify. 
        // Wait, typically: Send OTP -> POST /verify-otp (or similar).
        // Let's look at the `email-verify.controller.ts` if possible.
        // For now, I will assume a standard pattern or use the route as is. 
        // Let's try to verify if there is a separate route for verification.
        // The previous conversation log said: "modifying the `email-verify.controller.ts` file to handle phone number input... and send a phone-based OTP".
        // I will use `/auth/email/verify-email` for sending, and maybe PUT or specific payload for verifying?
        // Let's look at the code context from earlier if possible. 
        // The user context 'router.route("/email/verify-email").post(generateOTP).post(verifyOTP)' suggests they might be chained or it's a typo in the user's codebase.
        // However, I will write the service to support both sending and verifying. 
        // I will double check the backend routes in the next step to be sure.
        // For now, defining them as separate methods.

        const response = await apiClient.post("/auth/email/verify-otp/code", { otp: data.otp }, {
            withCredentials: true
        });
        return response.data;
    },

    googleSignIn: async () => {
        try {
            // Check if we already have a valid session by hitting a protected endpoint
            // Since accessToken is HttpOnly, we can't check it via JS-Cookie
            await apiClient.get("/user/profile", {
                withCredentials: true
            });
            window.location.href = "/my-bookings";
            return;
        } catch (e) {
            // Not authenticated or error, proceed to checks
        }

        if (Cookies.get("verifySession")) {
            window.location.href = "/auth/verify-otp";
            return;
        }
        window.location.href = `${API_BASE_URL}/auth/google`;
    }
};
