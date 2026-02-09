import axios, { AxiosResponse } from 'axios';
import { generateOTPEmailTemplate, OTPTemplateOptions } from "./emailtemplate.js"
import dotenv from "dotenv"
dotenv.config()
interface MSG91Config {
  authKey: string;
  apiUrl: string;
}

interface EmailRecipient {
  name: string;
  email: string;
}

interface EmailSender {
  name: string;
  email: string;
}

interface MSG91EmailPayload {
  to: EmailRecipient[];
  from: EmailSender;
  subject: string;
  body: string;
}

interface EmailResponse {
  success: boolean;
  data?: any;
  error?: any;
}

interface SendOTPEmailParams {
  recipientEmail: string;
  recipientName: string;
  otp: number;
  senderEmail: string;
  senderName?: string;
  expiryMinutes?: number;
}

const MSG91_CONFIG: MSG91Config = {
  authKey: process.env.MSG91_AUTH_KEY || 'YOUR_AUTH_KEY_HERE',
  apiUrl: 'https://control.msg91.com/api/v5/email/send'
};

/**
 * Send OTP Email via MSG91
 * @param params - Email parameters
 * @returns Promise with success status and response data
 */
export async function sendOTPEmail(params: SendOTPEmailParams): Promise<EmailResponse> {
  const {
    recipientEmail,
    recipientName,
    otp,
    senderEmail,
    senderName = 'Your Company',
    expiryMinutes = 10
  } = params;

  try {
    const htmlContent = generateOTPEmailTemplate({
      otp,
      userName: recipientName,
      expiryMinutes,
      companyName: senderName
    });
    
    const payload: MSG91EmailPayload = {
      to: [
        {
          name: recipientName,
          email: recipientEmail
        }
      ],
      from: {
        name: senderName,
        email: senderEmail
      },
      subject: `Your OTP Code: ${otp}`,
      body: htmlContent
    };

    const response: AxiosResponse = await axios.post(
      MSG91_CONFIG.apiUrl,
      payload,
      {
        headers: {
          'authkey': MSG91_CONFIG.authKey,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('OTP email sent successfully:', response.data);
    return {
      success: true,
      data: response.data
    };

  } catch (error: any) {
    console.error('Error sending OTP email:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

export type { EmailResponse, SendOTPEmailParams };