import { Role } from "@repo/database/client";
import {
  makeForgotPasswordCodeController,
  makeResetPasswordCodeController,
} from "../../services/passwordReset/passwordReset.controller.js";

// Self-service customer password reset via a 6-digit emailed code (mobile
// app). The logic lives in services/passwordReset and is shared with the Fleet
// Executive mount (/api/employee/auth/email/*); the code is sent over SMTP like
// the web reset links. Paths, request fields and messages are unchanged for the
// app builds already in the field; responses only gained fields.
export const forgotPassword = makeForgotPasswordCodeController([Role.CUSTOMER]);
export const resetPassword = makeResetPasswordCodeController([Role.CUSTOMER]);
