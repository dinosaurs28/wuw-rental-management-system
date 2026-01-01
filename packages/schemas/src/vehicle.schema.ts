import {z} from "zod";

export const getVehicleDetailsSchema=z.object({
    id:z.string().min(16,"Vehicle ID length is invalid.")
})

export const bookingSummarySchema=z.object({
  vehicles: z.array(z.string().min(1)),
  start: z.string().min(1),
  end: z.string().min(1)
})

export const createVehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  regNo: z.string().min(1, "Registration Number is required"),
  odo: z.coerce.number().min(0),
  insuranceExpiry: z.string(), 
  baseDailyPrice: z.coerce.number().positive(),
  categoryId: z.coerce.number().int().positive()
});

export const editVehicleSchema = createVehicleSchema.partial().extend({
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'INACTIVE']).optional(),
  deleteImageIds: z.string().optional() 
});