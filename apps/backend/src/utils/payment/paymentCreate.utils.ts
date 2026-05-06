import axios from "axios";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { config } from "dotenv";
config();
const MERCHANT_ID = process.env.MERCHANT_ID;
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX;
const HOST_URL = process.env.PHONE_PE_HOST_URL!;
const redirectUrl = process.env.REDIRECT_URL_PAY;

export async function initiatePhonePePayment(
  amount: number,
  customBaseRedirectUrl?: string,
  customerPublicId?: string,
) {
  const transactionId = `MT-${uuidv4().replace(/-/g, '')}`;

  // Use custom redirect URL if provided, otherwise default to env var
  // valid redirectUrl MUST include the transactionId or handle
  // it
  const baseUrl = customBaseRedirectUrl || redirectUrl;
  const finalRedirectUrl = `${baseUrl}/${transactionId}`;

  const payload = {
    merchantId: MERCHANT_ID,
    merchantTransactionId: transactionId,
    merchantUserId: customerPublicId ? `MUID-${customerPublicId}` : `MUID-${uuidv4().replace(/-/g, '')}`,
    amount: Math.round(amount * 100),
    redirectUrl: finalRedirectUrl,
    redirectMode: "REDIRECT",
    callbackUrl: process.env.BACKEND_CALLBACK_URL ? `${process.env.BACKEND_CALLBACK_URL}/api/payment/phonepe/webhook` : finalRedirectUrl,
    paymentInstrument: {
      type: "PAY_PAGE",
    },
  };
  const bufferObj = Buffer.from(JSON.stringify(payload), "utf8");
  const base64Payload = bufferObj.toString("base64");
  const stringToHash = base64Payload + "/pg/v1/pay" + SALT_KEY;
  const sha256 = createHash("sha256").update(stringToHash).digest("hex");
  const checksum = sha256 + "###" + SALT_INDEX;

  try {
    const response = await axios.post(
      `${HOST_URL}/pg/v1/pay`,
      { request: base64Payload },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
          accept: "application/json",
        },
      },
    );
    return { ...response.data.data, merchantTransactionId: transactionId };
  } catch (error: any) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("Payment Error:", errorData);
    throw new Error(errorData?.message || "Failed to initiate payment");
  }
}
