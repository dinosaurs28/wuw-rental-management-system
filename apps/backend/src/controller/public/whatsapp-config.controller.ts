import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

const CACHE_KEY = "whatsapp:support:config";
const CACHE_TTL = 300; // 5 minutes

export const GetPublicWhatsAppConfig = async (req: Request, res: Response) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const config = JSON.parse(cached);
      if (!config.isEnabled) {
        return res.status(StatusCode.OK).json({ data: null });
      }
      return res.status(StatusCode.OK).json({
        data: {
          phoneNumber: config.phoneNumber,
          messageTemplate: config.messageTemplate,
          isEnabled: config.isEnabled,
        },
      });
    }

    const config = await prisma.whatsAppSupportConfig.findFirst();

    if (!config || !config.isEnabled) {
      return res.status(StatusCode.OK).json({ data: null });
    }

    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(config));

    return res.status(StatusCode.OK).json({
      data: {
        phoneNumber: config.phoneNumber,
        messageTemplate: config.messageTemplate,
        isEnabled: config.isEnabled,
      },
    });
  } catch (error) {
    console.error("GetPublicWhatsAppConfig Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
