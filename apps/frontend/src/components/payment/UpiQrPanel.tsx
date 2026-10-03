import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Smartphone,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatInrExact } from "@/lib/gst";
import type { UpiQrPaymentState } from "@/hooks/useUpiQrPayment";
import type { UpiQrView } from "@/services/upiQr.service";

/** A new booking QR needs about 3 minutes of hold left (Razorpay's 2 min + the 45 s settle buffer). */
const MIN_HOLD_FOR_NEW_QR_MS = 3 * 60_000;

/** Create errors the customer can simply try again. */
const RETRYABLE_CODES = new Set([
  "GATEWAY_UNAVAILABLE",
  "QR_CREATE_FAILED",
  "QR_BUSY",
  "QR_NOT_FOUND",
]);

interface UpiQrPanelProps {
  qr: UpiQrPaymentState;
  kind: "booking" | "extension";
  /** Booking hold end — whether a new QR can still be made for it. */
  holdExpiresAt?: string | null;
  /** Booking: the hold is over — go back and start again. */
  onRestart?: () => void;
  /** Leave the QR for the normal payment window (the caller closes the QR). */
  onPayAnotherWay?: () => void;
  /** Dismiss a terminal state that needs nothing more (e.g. a refund notice). */
  onDone?: () => void;
  /** The payment was applied by another channel — open the confirmed booking / extension. */
  onViewConfirmed?: (view: UpiQrView) => void;
}

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function purposeLabel(view: UpiQrView) {
  switch (view.purpose) {
    case "ADVANCE":
      return "Advance for your booking";
    case "FULL_PAYMENT":
      return "Payment for your booking";
    case "EXTENSION":
      return "Payment for your extension";
  }
}

/** The booking / extension this QR pays is confirmed — whichever channel paid it. */
function isTargetConfirmed(view: UpiQrView) {
  if (view.extension) return view.extension.extensionStatus === "CONFIRMED";
  return view.booking.status !== "HOLD" && view.booking.paymentStatus === "SUCCESS";
}

/**
 * "Pay by scanning a UPI QR" (TODO #2) — for a customer whose device has no UPI
 * app: the QR is scanned with any UPI app on another phone. Shows the QR, the
 * exact amount and a countdown, and follows the server's outcome.
 */
export function UpiQrPanel({
  qr,
  kind,
  holdExpiresAt,
  onRestart,
  onPayAnotherWay,
  onDone,
  onViewConfirmed,
}: UpiQrPanelProps) {
  const { view, error, isCreating, isClosing, isChecking, connectionIssue, pollStopped, secondsLeft } = qr;
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  // Clock for the hold checks below, ticking only while a hold bounds the QR
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!holdExpiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [holdExpiresAt]);

  const holdLeftMs = holdExpiresAt ? new Date(holdExpiresAt).getTime() - now : null;
  const holdOver = kind === "booking" && holdLeftMs !== null && holdLeftMs <= 0;
  /** Bookings: only while enough hold is left for Razorpay to accept a new QR. */
  const canMakeNewQr =
    kind === "extension" || holdLeftMs === null || holdLeftMs > MIN_HOLD_FOR_NEW_QR_MS;
  const busy = isCreating || isClosing;

  const payAnotherWay = onPayAnotherWay && !holdOver && (
    <Button variant="outline" className="w-full" onClick={onPayAnotherWay} disabled={busy}>
      {isClosing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
      Pay another way
    </Button>
  );

  const generateNew = (
    <Button
      className="w-full bg-[#FF5F00] text-white hover:bg-[#e65600]"
      onClick={() => void qr.start()}
      disabled={busy}
    >
      {isCreating ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 size-4" />
      )}
      Generate new QR
    </Button>
  );

  const restart = onRestart && (
    <Button className="w-full bg-[#FF5F00] text-white hover:bg-[#e65600]" onClick={onRestart}>
      Start the booking again
    </Button>
  );

  // ── Creating the first QR ──
  if (!view && !error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-[#FF5F00]" />
        <p className="text-sm font-medium text-gray-700">Creating your UPI QR code…</p>
      </div>
    );
  }

  // ── Could not create / lost the QR ──
  if (!view && error) {
    const holdEnded = error.code === "HOLD_EXPIRED";
    return (
      <div className="space-y-4 pt-1">
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error.message}</span>
        </div>
        <div className="space-y-2">
          {holdEnded
            ? restart
            : RETRYABLE_CODES.has(error.code ?? "") || !error.code
              ? canMakeNewQr && (
                  <Button
                    className="w-full bg-[#FF5F00] text-white hover:bg-[#e65600]"
                    onClick={() => void qr.start()}
                    disabled={busy}
                  >
                    {isCreating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
                    Try again
                  </Button>
                )
              : null}
          {!holdEnded && payAnotherWay}
        </div>
      </div>
    );
  }

  if (!view) return null;

  // ── Paid and applied ──
  if (view.outcome === "CONFIRMED") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center" aria-live="polite">
        <div className="flex size-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="size-8 text-green-600" />
        </div>
        <p className="text-base font-semibold text-gray-900">{view.message}</p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Taking you to your {kind === "booking" ? "booking" : "updated booking"}…
        </p>
      </div>
    );
  }

  // ── Paid, but it can't be applied: refund notice (terminal) ──
  if (view.outcome === "REFUND_REQUIRED") {
    const confirmedElsewhere = isTargetConfirmed(view);
    return (
      <div className="space-y-4 pt-1" aria-live="polite">
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <Info className="size-4 shrink-0" />
            Payment will be refunded
          </div>
          <p>{view.message}</p>
          <p className="text-xs text-amber-800">
            {formatInrExact(view.amount)} · the branch has been told to refund this payment.
          </p>
        </div>
        <div className="space-y-2">
          {confirmedElsewhere && onViewConfirmed ? (
            <Button
              className="w-full bg-[#FF5F00] text-white hover:bg-[#e65600]"
              onClick={() => onViewConfirmed(view)}
            >
              {kind === "booking" ? "View my booking" : "Done"}
            </Button>
          ) : kind === "booking" ? (
            // Still on hold (e.g. the amount didn't match): the normal payment window can still be used
            view.booking.status === "HOLD" && !holdOver ? payAnotherWay : restart
          ) : (
            onDone && (
              <Button variant="outline" className="w-full" onClick={onDone}>
                Close
              </Button>
            )
          )}
        </div>
      </div>
    );
  }

  // ── Expired / closed: offer a new QR while the payment is still open ──
  if (view.outcome === "EXPIRED" || view.outcome === "CLOSED") {
    return (
      <div className="space-y-4 pt-1" aria-live="polite">
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
          <Clock className="mt-0.5 size-4 shrink-0 text-gray-500" />
          <span>{view.message}</span>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error.message}</span>
          </div>
        )}
        <div className="space-y-2">
          {canMakeNewQr && !holdOver ? generateNew : restart}
          {payAnotherWay}
        </div>
      </div>
    );
  }

  // ── Waiting for the payment ──
  const expiring = secondsLeft === 0;
  const imageBroken = imageFailed === view.imageUrl;
  return (
    <div className="space-y-4 pt-1">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{purposeLabel(view)}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">
          Pay exactly {formatInrExact(view.amount)}
        </p>
      </div>

      <div className="flex justify-center">
        <div
          className={cn(
            "relative flex size-60 items-center justify-center rounded-2xl border-2 bg-white p-3 shadow-sm",
            expiring ? "border-gray-200" : "border-[#FF5F00]/30",
          )}
        >
          {imageBroken ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-gray-600">
              <AlertCircle className="size-6 text-gray-400" />
              <span>The QR image didn't load.</span>
              <Button size="sm" variant="outline" onClick={() => setImageFailed(null)}>
                Reload image
              </Button>
            </div>
          ) : (
            <img
              key={view.qrPaymentId}
              src={view.imageUrl}
              alt={`UPI QR code to pay ${formatInrExact(view.amount)}`}
              className={cn("size-full object-contain", expiring && "opacity-40")}
              onError={() => setImageFailed(view.imageUrl)}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5" aria-live="polite">
        {expiring ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600">
            <Loader2 className="size-4 animate-spin" />
            Checking the final payment status…
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              secondsLeft < 60 ? "bg-red-50 text-red-600" : "bg-orange-50 text-[#c74a00]",
            )}
          >
            <Clock className="size-4" />
            QR expires in {formatClock(secondsLeft)}
          </span>
        )}
        <a
          href={view.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
        >
          Open QR image <ExternalLink className="size-3" />
        </a>
      </div>

      <ol className="space-y-1.5 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <li className="flex gap-2">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-gray-400" />
          <span>Open any UPI app (GPay, PhonePe, Paytm, BHIM…) on another phone.</span>
        </li>
        <li className="pl-6">Scan this QR and pay exactly {formatInrExact(view.amount)}.</li>
        <li className="pl-6">Keep this screen open — it updates by itself once the payment lands.</li>
      </ol>

      {(view.gatewayUnreachable || connectionIssue) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          <span>
            {view.gatewayUnreachable
              ? view.message
              : "Having trouble reaching the server — still checking for your payment."}
          </span>
        </div>
      )}

      {pollStopped && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
          <p>We haven't received this payment yet. If you've just paid, check again.</p>
          <Button variant="outline" size="sm" onClick={() => void qr.checkNow()} disabled={isChecking}>
            {isChecking ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            Check again
          </Button>
        </div>
      )}

      {payAnotherWay}
    </div>
  );
}
