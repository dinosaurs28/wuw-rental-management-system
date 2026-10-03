import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/counterErrors";
import {
  apiErrorCode,
  upiQrService,
  type UpiQrTarget,
  type UpiQrView,
} from "@/services/upiQr.service";

/** The contract asks for a 3 s poll; the server talks to Razorpay at most every 2.5 s. */
const POLL_INTERVAL_MS = 3000;
/**
 * How long past the QR's close time the poll keeps asking before it hands over
 * to a "Check again" button — a payment made at the last second still settles.
 */
const POLL_GRACE_AFTER_CLOSE_MS = 120_000;
/** QR_BUSY = a concurrent create for the same payment: retried quietly. */
const BUSY_RETRIES = 2;
const BUSY_RETRY_DELAY_MS = 1500;

export interface UpiQrFailure {
  code?: string;
  message: string;
}

export type UpiQrCloseResult =
  | { ok: true; view: UpiQrView | null }
  | { ok: false; message: string };

interface UseUpiQrPaymentOptions {
  /** What the QR pays. Read when `start` runs. */
  target: UpiQrTarget | null;
  /** Fired once per QR when the server reports the payment applied. */
  onConfirmed?: (view: UpiQrView) => void;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives one UPI QR payment (TODO #2): create (or reuse) the QR, poll its
 * status every 3 s while it waits for the payment, count down to its close
 * time, and close it when the customer leaves. Every outcome comes from the
 * server — nothing is decided locally.
 */
export function useUpiQrPayment({ target, onConfirmed }: UseUpiQrPaymentOptions) {
  const [view, setView] = useState<UpiQrView | null>(null);
  const [error, setError] = useState<UpiQrFailure | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  /** The last poll failed to reach our server; polling carries on. */
  const [connectionIssue, setConnectionIssue] = useState(false);
  /** The poll gave up after the grace period; the customer can check again. */
  const [pollStopped, setPollStopped] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const viewRef = useRef<UpiQrView | null>(null);
  /** Local clock time the QR closes, fixed from the first response for that QR (no clock skew). */
  const deadlineRef = useRef(0);
  const deadlineForRef = useRef<string | null>(null);
  const closedRef = useRef<string | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const createSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const accept = useCallback((next: UpiQrView) => {
    if (deadlineForRef.current !== next.qrPaymentId) {
      deadlineForRef.current = next.qrPaymentId;
      deadlineRef.current = Date.now() + Math.max(0, next.expiresInSeconds) * 1000;
    }
    viewRef.current = next;
    setView(next);
    setSecondsLeft(
      next.status === "ACTIVE"
        ? Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
        : 0,
    );
  }, []);

  const poll = useCallback(async () => {
    const current = viewRef.current;
    if (!current || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const next = await upiQrService.getStatus(current.qrPaymentId);
      if (!mountedRef.current || viewRef.current?.qrPaymentId !== next.qrPaymentId) return;
      setConnectionIssue(false);
      accept(next);
    } catch (err) {
      if (!mountedRef.current || viewRef.current?.qrPaymentId !== current.qrPaymentId) return;
      if (apiErrorCode(err) === "QR_NOT_FOUND") {
        viewRef.current = null;
        setView(null);
        setError({
          code: "QR_NOT_FOUND",
          message: apiErrorMessage(err, "This QR code could not be found. Please generate a new one."),
        });
      } else {
        // Unknown is never "failed": keep asking
        setConnectionIssue(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [accept]);

  /** Creates the QR — or gets the still-open one for the same payment back. */
  const start = useCallback(async () => {
    const t = targetRef.current;
    if (!t) return;
    const seq = ++createSeqRef.current;
    setIsCreating(true);
    setError(null);
    setPollStopped(false);
    setConnectionIssue(false);
    for (let attempt = 0; ; attempt++) {
      try {
        const next = await upiQrService.create(t);
        if (!mountedRef.current || seq !== createSeqRef.current) return;
        closedRef.current = null;
        accept(next);
        break;
      } catch (err) {
        if (!mountedRef.current || seq !== createSeqRef.current) return;
        const code = apiErrorCode(err);
        if (code === "QR_BUSY" && attempt < BUSY_RETRIES) {
          await wait(BUSY_RETRY_DELAY_MS);
          if (!mountedRef.current || seq !== createSeqRef.current) return;
          continue;
        }
        viewRef.current = null;
        setView(null);
        setError({
          code,
          message: apiErrorMessage(
            err,
            "We couldn't create a UPI QR code right now. Please try again or pay another way.",
          ),
        });
        break;
      }
    }
    setIsCreating(false);
  }, [accept]);

  /** Manual "Check again" once the automatic poll has stopped. */
  const checkNow = useCallback(async () => {
    setIsChecking(true);
    setPollStopped(false);
    // Give the restarted poll its own grace window
    deadlineRef.current = Date.now();
    await poll();
    if (mountedRef.current) setIsChecking(false);
  }, [poll]);

  /**
   * Stops the QR taking money. A payment that already landed is settled by the
   * server: the returned view then says CONFIRMED (and `onConfirmed` fires) or
   * REFUND_REQUIRED. `ok: false` when the gateway could not be reached.
   */
  const close = useCallback(async (): Promise<UpiQrCloseResult> => {
    const current = viewRef.current;
    if (!current) return { ok: true, view: null };
    if (current.outcome !== "PENDING" || closedRef.current === current.qrPaymentId) {
      return { ok: true, view: current };
    }
    setIsClosing(true);
    try {
      const next = await upiQrService.close(current.qrPaymentId);
      closedRef.current = current.qrPaymentId;
      if (mountedRef.current && viewRef.current?.qrPaymentId === next.qrPaymentId) accept(next);
      return { ok: true, view: next };
    } catch (err) {
      return {
        ok: false,
        message: apiErrorMessage(err, "We couldn't close the QR code. Please try again in a moment."),
      };
    } finally {
      if (mountedRef.current) setIsClosing(false);
    }
  }, [accept]);

  /** Forget the current QR (after it was closed) so the next `start` begins clean. */
  const reset = useCallback(() => {
    createSeqRef.current++;
    viewRef.current = null;
    deadlineForRef.current = null;
    setView(null);
    setError(null);
    setIsCreating(false);
    setPollStopped(false);
    setConnectionIssue(false);
    setSecondsLeft(0);
  }, []);

  const pending = view?.outcome === "PENDING";
  const qrPaymentId = view?.qrPaymentId ?? null;

  // Status poll while the QR waits for its payment
  useEffect(() => {
    if (!pending || !qrPaymentId || pollStopped) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (cancelled) return;
      if (Date.now() > deadlineRef.current + POLL_GRACE_AFTER_CLOSE_MS) {
        setPollStopped(true);
        return;
      }
      await poll();
      if (!cancelled) timer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    timer = setTimeout(loop, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pending, qrPaymentId, pollStopped, poll]);

  // Countdown to the close time — at 0, ask once more straight away
  useEffect(() => {
    if (!pending || !qrPaymentId) return;
    let askedAtZero = false;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && !askedAtZero) {
        askedAtZero = true;
        void poll();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [pending, qrPaymentId, poll]);

  // Payment applied: hand over to the screen's existing success flow, once
  useEffect(() => {
    if (view?.outcome === "CONFIRMED" && confirmedRef.current !== view.qrPaymentId) {
      confirmedRef.current = view.qrPaymentId;
      onConfirmedRef.current?.(view);
    }
  }, [view]);

  // Leaving the screen with the QR still open: stop it taking money
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = viewRef.current;
      if (current && current.outcome === "PENDING" && closedRef.current !== current.qrPaymentId) {
        closedRef.current = current.qrPaymentId;
        void upiQrService.close(current.qrPaymentId).catch(() => undefined);
      }
    };
  }, []);

  return {
    view,
    error,
    isCreating,
    isClosing,
    isChecking,
    connectionIssue,
    pollStopped,
    secondsLeft,
    start,
    close,
    reset,
    checkNow,
  };
}

export type UpiQrPaymentState = ReturnType<typeof useUpiQrPayment>;

/**
 * Whether to offer "Pay by scanning a UPI QR" (ops switch + gateway keys).
 * Hidden on any error — an older server without the endpoint included.
 */
export function useUpiQrAvailability(enabled = true) {
  const { data } = useQuery({
    queryKey: ["upi-qr-availability"],
    queryFn: upiQrService.getAvailability,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return enabled && data?.enabled === true;
}
