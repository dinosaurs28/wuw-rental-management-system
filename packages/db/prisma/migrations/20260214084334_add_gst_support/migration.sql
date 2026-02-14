-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "totalTax" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BookingItem" ADD COLUMN     "cgstAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "sgstAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GSTRule" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "gstNumber" TEXT NOT NULL,
    "cgstRate" DECIMAL(65,30) NOT NULL DEFAULT 9.00,
    "sgstRate" DECIMAL(65,30) NOT NULL DEFAULT 9.00,
    "igstRate" DECIMAL(65,30) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GSTRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GSTRule_publicId_key" ON "GSTRule"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "GSTRule_branchId_key" ON "GSTRule"("branchId");

-- AddForeignKey
ALTER TABLE "GSTRule" ADD CONSTRAINT "GSTRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
