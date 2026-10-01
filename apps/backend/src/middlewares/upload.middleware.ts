import multer from "multer";
import path from "path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createID } from "../utils/nanoID.js";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${createID()}${ext}`);
  },
});

export const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ── Image-only uploads (identity photos) ──────────────────────────────────────
// The declared MIME type is only a first filter: the controllers still decode
// the real bytes with sharp, so a renamed PDF or an undecodable HEIC is turned
// away there with a 400 as well.

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

class UnsupportedFileTypeError extends Error {
  constructor() {
    super("Only JPG, PNG or WebP photos are accepted.");
    this.name = "UnsupportedFileTypeError";
  }
}

/**
 * Single-file image upload that always answers in JSON: a file over `maxBytes`
 * is a 413 FILE_TOO_LARGE and a non-image is a 400 INVALID_FILE_TYPE, instead
 * of Express's default HTML 500 for multer errors.
 */
export function handleImageUpload(
  field: string,
  { maxBytes = 10 * 1024 * 1024 }: { maxBytes?: number } = {},
): RequestHandler {
  const imageUpload = multer({
    storage,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || "").toLowerCase();
      if ((ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
        cb(null, true);
      } else {
        cb(new UnsupportedFileTypeError());
      }
    },
  }).single(field);

  const maxMb = Math.round(maxBytes / (1024 * 1024));

  return (req: Request, res: Response, next: NextFunction) => {
    imageUpload(req, res, (err: unknown) => {
      if (!err) return next();

      if (err instanceof UnsupportedFileTypeError) {
        return res.status(400).json({
          success: false,
          code: "INVALID_FILE_TYPE",
          message: err.message,
        });
      }
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            code: "FILE_TOO_LARGE",
            message: `The photo is larger than ${maxMb} MB. Please retake it or choose a smaller photo.`,
          });
        }
        return res.status(400).json({
          success: false,
          code: "INVALID_UPLOAD",
          message: `Upload exactly one photo in the '${field}' field.`,
        });
      }
      console.error("[handleImageUpload] Upload failed:", err);
      return res.status(400).json({
        success: false,
        code: "INVALID_UPLOAD",
        message: "The upload could not be read. Please try again.",
      });
    });
  };
}

/**
 * `upload.single(field)` with the same storage, size limit and (unfiltered)
 * file types, but multer failures answer in JSON instead of Express's default
 * HTML 500: a file over `maxBytes` is a 413 FILE_TOO_LARGE, a wrong field name /
 * extra file / malformed multipart body is a 400 INVALID_UPLOAD. Used by the
 * pickup, return and damage photo uploads (their controllers decode the bytes).
 */
export function handleFileUpload(
  field: string,
  { maxBytes = 15 * 1024 * 1024 }: { maxBytes?: number } = {},
): RequestHandler {
  const fileUpload = multer({ storage, limits: { fileSize: maxBytes } }).single(field);
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  return (req: Request, res: Response, next: NextFunction) => {
    fileUpload(req, res, (err: unknown) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            code: "FILE_TOO_LARGE",
            message: `The photo is larger than ${maxMb} MB. Please retake it or choose a smaller photo.`,
          });
        }
        return res.status(400).json({
          success: false,
          code: "INVALID_UPLOAD",
          message: `Upload one photo in the '${field}' field.`,
        });
      }
      // Disk errors (uploads/ missing, disk full) are ours, not the client's
      if ((err as NodeJS.ErrnoException)?.syscall) {
        console.error("[handleFileUpload] Saving the upload failed:", err);
        return res.status(500).json({
          success: false,
          code: "UPLOAD_FAILED",
          message: "The photo couldn't be saved. Please try again.",
        });
      }
      console.error("[handleFileUpload] Upload failed:", err);
      return res.status(400).json({
        success: false,
        code: "INVALID_UPLOAD",
        message: "The upload could not be read. Please try again.",
      });
    });
  };
}
