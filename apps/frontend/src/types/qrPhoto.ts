// Customer QR code photo (#4): a photo of the QR the walk-in customer presents
// (Aadhaar / DigiLocker). Shapes mirror the D2 backend contract.

/** Presigned view of a stored QR photo. `url` is valid for `expiresIn` seconds (15 min). */
export interface QrPhotoView {
  /** FileObject publicId; sent as `qr_photo_id` when creating a walk-in booking. */
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

export interface QrPhotoCustomer {
  publicId: string;
  name: string;
  phone: string;
}

/** BOOKING = snapshot on this booking; CUSTOMER = the customer's current photo (no snapshot). */
export type QrPhotoSource = "BOOKING" | "CUSTOMER" | null;

export interface CustomerQrPhotoData {
  customer: QrPhotoCustomer;
  qrPhoto: QrPhotoView | null;
}

export interface BookingQrPhotoData {
  booking: { publicId: string; status: string };
  customer: QrPhotoCustomer;
  qrPhoto: QrPhotoView | null;
  source: QrPhotoSource;
  /** True only while the booking is HOLD or CONFIRMED. */
  canReplace: boolean;
}

export interface QrPhotoResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
