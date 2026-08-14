interface PasswordResetTemplateOptions {
  userName?: string;
  resetLink: string;
  expiryMinutes?: number;
  companyName?: string;
}

export function generatePasswordResetEmailTemplate(
  options: PasswordResetTemplateOptions,
): string {
  const {
    userName = "User",
    resetLink,
    expiryMinutes = 30,
    companyName = "WUW",
  } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Reset Your Password</h1>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <p style="color: #333333; font-size: 16px; line-height: 24px; margin: 0 0 20px;">
                                Hi <strong>${userName}</strong>,
                            </p>

                            <p style="color: #666666; font-size: 14px; line-height: 22px; margin: 0 0 30px;">
                                We received a request to reset the password for your account. Click the button below to choose a new password:
                            </p>

                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="padding: 10px 0 30px;">
                                        <a href="${resetLink}" style="background-color: #667eea; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: bold; display: inline-block;">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <p style="color: #666666; font-size: 13px; line-height: 20px; margin: 0 0 20px; word-break: break-all;">
                                Or copy and paste this link into your browser:<br>
                                <a href="${resetLink}" style="color: #667eea;">${resetLink}</a>
                            </p>

                            <p style="color: #666666; font-size: 14px; line-height: 22px; margin: 20px 0; text-align: center;">
                                <strong style="color: #e74c3c;">⏰ This link will expire in ${expiryMinutes} minutes</strong>
                            </p>

                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                <tr>
                                    <td style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
                                        <p style="color: #856404; font-size: 13px; line-height: 20px; margin: 0;">
                                            <strong>⚠️ Security Alert:</strong> If you didn't request this password reset, please ignore this email — your password will remain unchanged.
                                        </p>
                                    </td>
                                </tr>
                            </table>
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

export type { PasswordResetTemplateOptions };
