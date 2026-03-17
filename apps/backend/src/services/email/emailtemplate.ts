interface OTPTemplateOptions {
  otp: number;
  userName?: string;
  expiryMinutes?: number;
  companyName?: string;
}

/**
 * Generate OTP HTML Email Template
 * @param options - Template configuration options
 * @returns HTML string for the email
 */
export function generateOTPEmailTemplate(options: OTPTemplateOptions): string {
  const {
    otp,
    userName = "User",
    expiryMinutes = 10,
    companyName = "Your Company",
  } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Verification Code</h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <p style="color: #333333; font-size: 16px; line-height: 24px; margin: 0 0 20px;">
                                Hi <strong>${userName}</strong>,
                            </p>
                            
                            <p style="color: #666666; font-size: 14px; line-height: 22px; margin: 0 0 30px;">
                                We received a request to verify your account. Please use the following One-Time Password (OTP) to complete your verification:
                            </p>
                            
                            <!-- OTP Box -->
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <div style="background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; display: inline-block;">
                                            <span style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                                ${otp}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="color: #666666; font-size: 14px; line-height: 22px; margin: 30px 0 20px; text-align: center;">
                                <strong style="color: #e74c3c;">⏰ This OTP will expire in ${expiryMinutes} minutes</strong>
                            </p>
                            
                            <!-- Warning Box -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                <tr>
                                    <td style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
                                        <p style="color: #856404; font-size: 13px; line-height: 20px; margin: 0;">
                                            <strong>⚠️ Security Alert:</strong> Never share this OTP with anyone. ${companyName} will never ask for your OTP via phone or email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="color: #666666; font-size: 14px; line-height: 22px; margin: 20px 0 0;">
                                If you didn't request this verification code, please ignore this email or contact our support team immediately.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
                            <p style="color: #999999; font-size: 12px; line-height: 18px; margin: 0 0 10px;">
                                This is an automated message, please do not reply to this email.
                            </p>
                            <p style="color: #999999; font-size: 12px; line-height: 18px; margin: 0;">
                                © ${new Date().getFullYear()} ${companyName}. All rights reserved.
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
  `;
}

export type { OTPTemplateOptions };
