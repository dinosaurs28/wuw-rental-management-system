import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_OTP_TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID;
const MSG91_OTP_URL = process.env.MSG91_OTP_URL!;

interface SendOTPParams {
  mobile: string;
  otp: number;
}

interface OTPResponse {
  success: boolean;
  message?: string;
  type?: string;
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
          template_id: MSG91_OTP_TEMPLATE_ID,
          mobile: mobile,
          otp: otp,
        },
        headers: {
          authkey: MSG91_AUTH_KEY,
        },
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
    return { success: false, message: "Internal Error sending OTP" };
  }
};
