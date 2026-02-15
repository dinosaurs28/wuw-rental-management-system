-- CreateIndex
CREATE INDEX "Booking_status_startAt_endAt_idx" ON "Booking"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "BookingItem_vehicleId_bookingId_idx" ON "BookingItem"("vehicleId", "bookingId");

-- CreateIndex
CREATE INDEX "Vehicle_status_deletedAt_insuranceExpiry_idx" ON "Vehicle"("status", "deletedAt", "insuranceExpiry");

-- CreateIndex
CREATE INDEX "Vehicle_make_model_idx" ON "Vehicle"("make", "model");

-- CreateIndex
CREATE INDEX "Vehicle_branchId_categoryId_status_idx" ON "Vehicle"("branchId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "VehicleImage_vehicleId_isThumbnail_idx" ON "VehicleImage"("vehicleId", "isThumbnail");
