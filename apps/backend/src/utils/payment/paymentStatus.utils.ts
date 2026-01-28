import axios from "axios";
import { createHash } from "crypto";
import { config } from "dotenv";
config();

const MERCHANT_ID = process.env.MERCHANT_ID;
const SALT_KEY = process.env.SALT_KEY;
const SALT_INDEX = process.env.SALT_INDEX;
const HOST_URL = process.env.PHONE_PE_HOST_URL!;

export async function checkPhonePeStatus(merchantTransactionId: string) {
    const stringToHash = `/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}` + SALT_KEY;
    const sha256 = createHash('sha256').update(stringToHash).digest('hex');
    const checksum = sha256 + "###" + SALT_INDEX;

    try {
        const response = await axios.get(
            `${HOST_URL}/pg/v1/status/${MERCHANT_ID}/${merchantTransactionId}`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-VERIFY': checksum,
                    'X-MERCHANT-ID': MERCHANT_ID,
                    'accept': 'application/json'
                }
            }
        );
        return response.data;

    } catch (error: any) {
        console.error("Payment Status Check Error:", error.response ? error.response.data : error.message);
        return null; // Or throw error
    }
}
