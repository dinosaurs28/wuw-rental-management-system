/*
  Warnings:

  - You are about to drop the column `email` on the `EmailVerificationOtp` table. All the data in the column will be lost.
  - Added the required column `phone` to the `EmailVerificationOtp` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EmailVerificationOtp" DROP COLUMN "email",
ADD COLUMN     "phone" TEXT NOT NULL;
