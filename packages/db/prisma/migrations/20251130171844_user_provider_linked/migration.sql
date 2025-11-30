/*
  Warnings:

  - A unique constraint covering the columns `[provider,providerUserId]` on the table `UserProvider` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "provider_providerUserId_unique" ON "UserProvider"("provider", "providerUserId");
