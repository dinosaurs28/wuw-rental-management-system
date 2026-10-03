import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_OTP_TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID;
const MSG91_OTP_URL = process.env.MSG91_OTP_URL!;

interface SendOTPParams {
  mobile: string;
  otp: number;
  // A different MSG91 template (e.g. password-reset wording); defaults to
  // MSG91_OTP_TEMPLATE_ID.
  templateId?: string;
}

interface OTPResponse {
  success: boolean;
  message?: string;
  type?: string;
  // Transport/provider detail for diagnostics (never shown to customers).
  error?: string;
}

const MSG91_ENV_VARS = ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID", "MSG91_OTP_URL"] as const;

/** MSG91 env vars that are unset (empty list = SMS can be sent). */
export function smsMissingEnv(): string[] {
  return MSG91_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

export function isSmsConfigured(): boolean {
  return smsMissingEnv().length === 0;
}

/**
 * Send OTP via MSG91
 * @param params - { mobile, otp }
 */
export const sendOTP = async (params: SendOTPParams): Promise<OTPResponse> => {
  try {
    const { mobile, otp } = params;

    // Ensure mobile number has country code if not present.
    // MSG91 usually expects country code without +.
    // Assuming '91' for India as default if missing, or sanitize input.
    // For now, passing as is, assuming controller handles formatting or it's formatted.
    // But safer to ensure clean number.

    const response = await axios.post(
      MSG91_OTP_URL,
      {},
      {
        params: {
          template_id: params.templateId || MSG91_OTP_TEMPLATE_ID,
          mobile: mobile,
          otp: otp,
        },
        headers: {
          authkey: MSG91_AUTH_KEY,
        },
        // A stalled provider must not hold a request open indefinitely.
        timeout: 15_000,
      },
    );

    if (response.data?.type === "success") {
      console.log(`OTP Sent to ${mobile}`);
      return { success: true, message: "OTP sent successfully" };
    } else {
      console.error("MSG91 Error:", response.data);
      return {
        success: false,
        message: response.data?.message || "Failed to send OTP",
      };
    }
  } catch (error: any) {
    console.error("Error sending OTP:", error.response?.data || error.message);
    const detail = error.response?.data?.message || error.message;
    return {
      success: false,
      message: "Internal Error sending OTP",
      ...(detail ? { error: String(detail) } : {}),
    };
  }
};
