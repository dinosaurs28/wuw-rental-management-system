/** Input data provided by employee at vehicle return time. */
export interface ChargeReturnDataInput {
  returnFuelLevel?: string;
  fuelDeficitCharge?: number;
  fuelSkipReason?: string;
  fastagAmount?: number;
  fastagNotes?: string;
  applyGrace?: boolean;
}
