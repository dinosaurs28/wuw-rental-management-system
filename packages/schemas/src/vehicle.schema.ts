import {z} from "zod";

export const getVehicleDetailsSchema=z.object({
    id:z.string().min(16,"Vehicle ID length is invalid.")
})