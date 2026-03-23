/** Input data provided by employee at vehicle return time. */
export interface ChargeReturnDataInput {
  returnFuelLevel?: "EMPTY" | "QUARTER" | "HALF" | "THREE_QUARTER" | "FULL";
  fuelDeficitCharge?: number;
  fuelSkipReason?: string;
  fastagAmount?: number;
  fastagNotes?: string;
  applyGrace?: boolean;
}
