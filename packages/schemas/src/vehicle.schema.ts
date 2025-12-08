import {z} from "zod";

export const getVehicleDetailsSchema=z.object({
    id:z.string().min(16,"Vehicle ID length is invalid.")
})

export const bookingSummarySchema=z.object({
  vehicles: z.array(z.string().min(1)),
  start: z.string().min(1),
  end: z.string().min(1)
})