-- CreateTable
CREATE TABLE "TimezoneSetting" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimezoneSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimezoneSetting_publicId_key" ON "TimezoneSetting"("publicId");

-- CreateIndex
CREATE INDEX "TimezoneSetting_timezone_idx" ON "TimezoneSetting"("timezone");
