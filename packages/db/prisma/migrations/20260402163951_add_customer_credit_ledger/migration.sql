-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('PENDING', 'PARTIALLY_CLEARED', 'CLEARED');

-- CreateTable
CREATE TABLE "WhatsAppSupportConfig" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSupportConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnReceipt" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "receiptNumber" TEXT,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "totalCharges" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "depositPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "receiptPdfFileId" INTEGER,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditEntry" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "clearedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(10,2) NOT NULL,
    "status" "CreditStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditClearance" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "creditEntryId" INTEGER NOT NULL,
    "clearedSectionKeys" JSONB NOT NULL,
    "amountCleared" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "transactionRef" TEXT,
    "clearedById" INTEGER NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditClearance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSupportConfig_publicId_key" ON "WhatsAppSupportConfig"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceipt_publicId_key" ON "ReturnReceipt"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceipt_bookingId_key" ON "ReturnReceipt"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnReceipt_receiptNumber_key" ON "ReturnReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "ReturnReceipt_bookingId_idx" ON "ReturnReceipt"("bookingId");

-- CreateIndex
CREATE INDEX "ReturnReceipt_receiptPdfFileId_idx" ON "ReturnReceipt"("receiptPdfFileId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditEntry_publicId_key" ON "CustomerCreditEntry"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCreditEntry_bookingId_key" ON "CustomerCreditEntry"("bookingId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_customerId_idx" ON "CustomerCreditEntry"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_branchId_idx" ON "CustomerCreditEntry"("branchId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_bookingId_idx" ON "CustomerCreditEntry"("bookingId");

-- CreateIndex
CREATE INDEX "CustomerCreditEntry_status_idx" ON "CustomerCreditEntry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditClearance_publicId_key" ON "CreditClearance"("publicId");

-- CreateIndex
CREATE INDEX "CreditClearance_creditEntryId_idx" ON "CreditClearance"("creditEntryId");

-- AddForeignKey
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_receiptPdfFileId_fkey" FOREIGN KEY ("receiptPdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnReceipt" ADD CONSTRAINT "ReturnReceipt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditEntry" ADD CONSTRAINT "CustomerCreditEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditClearance" ADD CONSTRAINT "CreditClearance_creditEntryId_fkey" FOREIGN KEY ("creditEntryId") REFERENCES "CustomerCreditEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditClearance" ADD CONSTRAINT "CreditClearance_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
