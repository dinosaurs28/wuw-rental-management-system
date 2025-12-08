-- CreateTable
CREATE TABLE "PricingDiscountSlab" (
    "id" SERIAL NOT NULL,
    "days" INTEGER NOT NULL,
    "multiplier" DECIMAL(65,30) NOT NULL,
    "branchId" INTEGER,
    "categoryId" INTEGER,

    CONSTRAINT "PricingDiscountSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryDepositSetting" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "CategoryDepositSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryDepositSetting_branchId_categoryId_key" ON "CategoryDepositSetting"("branchId", "categoryId");

-- AddForeignKey
ALTER TABLE "PricingDiscountSlab" ADD CONSTRAINT "PricingDiscountSlab_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingDiscountSlab" ADD CONSTRAINT "PricingDiscountSlab_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryDepositSetting" ADD CONSTRAINT "CategoryDepositSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryDepositSetting" ADD CONSTRAINT "CategoryDepositSetting_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
