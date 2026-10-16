import sharp from "sharp";

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  size: number;
}

/**
 * Processes an image using sharp.
 * - Converts to JPEG
 * - Resizes to max 2000px dimension
 * - Compresses with quality 80
 */
export async function processImage(
  inputBuffer: Buffer,
): Promise<ProcessedImage> {
  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    // Target: Max 2000px dimension
    let resizeOptions = {};
    if (metadata.width && metadata.height) {
      if (metadata.width > 2000 || metadata.height > 2000) {
        resizeOptions = {
          width: metadata.width > metadata.height ? 2000 : undefined,
          height: metadata.height >= metadata.width ? 2000 : undefined,
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        };
      }
    }

    const processedBuffer = await image
      .rotate() // Auto-rotate based on EXIF
      .resize(resizeOptions)
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    return {
      buffer: processedBuffer,
      mimeType: "image/jpeg",
      extension: ".jpg",
      size: processedBuffer.length,
    };
  } catch (error) {
    console.error("Sharp processing error:", error);
    throw error;
  }
}

/** Longest side of the drop-screen "display" copy of a photo. */
export const DISPLAY_IMAGE_MAX_PX = 1200;

/**
 * The smaller "display" copy of a photo (drop screen strips): JPEG, longest
 * side at most DISPLAY_IMAGE_MAX_PX, quality 78, baseline (not progressive) so
 * phones decode it in one pass with less memory. Never enlarges.
 */
export async function processDisplayImage(inputBuffer: Buffer): Promise<ProcessedImage> {
  const buffer = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: DISPLAY_IMAGE_MAX_PX,
      height: DISPLAY_IMAGE_MAX_PX,
      fit: sharp.fit.inside,
      withoutEnlargement: true,
    })
    // mozjpeg's settings minus its progressive scans (`mozjpeg: true` forces them)
    .jpeg({
      quality: 78,
      progressive: false,
      optimiseCoding: true,
      trellisQuantisation: true,
      overshootDeringing: true,
      quantisationTable: 3,
    })
    .toBuffer();
  return { buffer, mimeType: "image/jpeg", extension: ".jpg", size: buffer.length };
}
