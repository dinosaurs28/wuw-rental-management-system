/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `EmailVerificationOtp` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `EmailVerificationOtp` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EmailVerificationOtp" ADD COLUMN     "userId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationOtp_userId_key" ON "EmailVerificationOtp"("userId");

-- AddForeignKey
ALTER TABLE "EmailVerificationOtp" ADD CONSTRAINT "EmailVerificationOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
