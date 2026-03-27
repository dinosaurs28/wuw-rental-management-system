import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";

const CACHE_KEY = "whatsapp:support:config";
const CACHE_TTL = 300; // 5 minutes

export const GetWhatsAppConfig = async (req: Request, res: Response) => {
  try {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        return res.status(StatusCode.OK).json({ data: JSON.parse(cached) });
      }
    } catch (redisError) {
      console.warn("Redis get error in GetWhatsAppConfig:", redisError);
    }

    const config = await prisma.whatsAppSupportConfig.findFirst();

    if (!config) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "WhatsApp config not found" });
    }

    try {
      await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(config));
    } catch (redisError) {
      console.warn("Redis set error in GetWhatsAppConfig:", redisError);
    }

    return res.status(StatusCode.OK).json({ data: config });
  } catch (error) {
    console.error("GetWhatsAppConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const UpsertWhatsAppConfig = async (req: Request, res: Response) => {
  const { phoneNumber, messageTemplate, isEnabled } = req.body;

  if (!phoneNumber || typeof phoneNumber !== "string") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "phoneNumber is required" });
  }
  if (!messageTemplate || typeof messageTemplate !== "string") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "messageTemplate is required" });
  }
  if (isEnabled !== undefined && typeof isEnabled !== "boolean") {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "isEnabled must be a boolean" });
  }

  // Strip non-digit chars and validate E.164-ish phone
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "phoneNumber must be 7-15 digits" });
  }

  try {
    const existing = await prisma.whatsAppSupportConfig.findFirst();

    const config = existing
      ? await prisma.whatsAppSupportConfig.update({
          where: { id: existing.id },
          data: {
            phoneNumber: digits,
            messageTemplate,
            ...(isEnabled !== undefined && { isEnabled }),
          },
        })
      : await prisma.whatsAppSupportConfig.create({
          data: {
            publicId: createID(),
            phoneNumber: digits,
            messageTemplate,
            isEnabled: isEnabled ?? true,
          },
        });

    try {
      await redis.del(CACHE_KEY);
    } catch (redisError) {
      console.warn("Failed to clear WhatsApp config cache:", redisError);
    }

    return res.status(StatusCode.OK).json({
      message: "WhatsApp config saved successfully",
      data: config,
    });
  } catch (error) {
    console.error("UpsertWhatsAppConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const ClearWhatsAppConfigCache = async (req: Request, res: Response) => {
  try {
    await redis.del(CACHE_KEY);
    return res.status(StatusCode.OK).json({ message: "WhatsApp config cache cleared" });
  } catch (error) {
    console.error("ClearWhatsAppConfigCache Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
