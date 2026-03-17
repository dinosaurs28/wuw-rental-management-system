import axios from "axios";
import { createHash } from "crypto";
import { config } from "dotenv";
config();
const MERCHANT_ID = process.env.MERCHANT_ID;
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX;
const HOST_URL = process.env.PHONE_PE_HOST_URL!;
export const paymentStatusCheck = async (transactionId: string) => {
  try {
    const apiPath = `/pg/v1/status/${MERCHANT_ID}/${transactionId}`;
    const stringToHash = apiPath + SALT_KEY;
    const sha256 = createHash("sha256").update(stringToHash).digest("hex");
    const checksum = sha256 + "###" + SALT_INDEX;
    const options = {
      method: "GET",
      url: `${HOST_URL}${apiPath}`,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "X-MERCHANT-ID": MERCHANT_ID,
      },
    };
    const response = await axios.request(options);
    return response.data;
  } catch (error: any) {
    console.error(
      "Status Check Error:",
      error.response ? error.response.data : error.message,
    );
  }
};
