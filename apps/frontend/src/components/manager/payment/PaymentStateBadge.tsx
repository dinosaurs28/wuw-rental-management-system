import type { LifecycleState, TransactionStatus, ShiftStatus } from "@/services/payment.service";
import type { ExtensionStatus } from "@/services/extension.service";

// ── Lifecycle State Badge ─────────────────────────────────────────────────────

const lifecycleMeta: Record<
  LifecycleState,
  { label: string; classes: string; icon: string }
> = {
  UNPAID: {
    label: "Unpaid",
    classes: "bg-red-50 text-red-700 border border-red-200",
    icon: "⚠",
  },
  PARTIALLY_PAID: {
    label: "Partial",
    classes: "bg-orange-50 text-orange-700 border border-orange-200",
    icon: "◑",
  },
  PAID_PENDING_CONFIRMATION: {
    label: "Pending Confirmation",
    classes: "bg-yellow-50 text-yellow-700 border border-yellow-200",
    icon: "⏳",
  },
  FULLY_PAID: {
    label: "Paid",
    classes: "bg-green-50 text-green-700 border border-green-200",
    icon: "✓",
  },
  OVERPAID: {
    label: "Overpaid",
    classes: "bg-purple-50 text-purple-700 border border-purple-200",
    icon: "!",
  },
  REFUNDED: {
    label: "Refunded",
    classes: "bg-neutral-100 text-neutral-600 border border-neutral-200",
    icon: "↩",
  },
};

export function LifecycleBadge({ state }: { state: LifecycleState }) {
  const meta = lifecycleMeta[state];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.classes}`}
    >
      <span>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

// ── Transaction Status Badge ──────────────────────────────────────────────────

const txnMeta: Record<
  TransactionStatus,
  { label: string; classes: string }
> = {
  INITIATED: {
    label: "Initiated",
    classes: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  COLLECTED: {
    label: "Awaiting Confirmation",
    classes: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  },
  CONFIRMED: {
    label: "Confirmed",
    classes: "bg-green-50 text-green-700 border border-green-200",
  },
  REJECTED: {
    label: "Rejected",
    classes: "bg-red-50 text-red-700 border border-red-200",
  },
  FAILED: {
    label: "Failed",
    classes: "bg-red-50 text-red-700 border border-red-200",
  },
  REFUNDED: {
    label: "Refunded",
    classes: "bg-neutral-100 text-neutral-600 border border-neutral-200",
  },
};

export function TransactionBadge({ status }: { status: TransactionStatus }) {
  const meta = txnMeta[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

// ── Shift Status Badge ────────────────────────────────────────────────────────

const shiftMeta: Record<
  ShiftStatus,
  { label: string; classes: string }
> = {
  OPEN: {
    label: "Open",
    classes: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  CLOSED: {
    label: "Closed",
    classes: "bg-green-50 text-green-700 border border-green-200",
  },
  DISCREPANCY_FLAGGED: {
    label: "Discrepancy",
    classes: "bg-red-50 text-red-700 border border-red-200",
  },
};

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  const meta = shiftMeta[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

// ── Refund Status Badge ───────────────────────────────────────────────────────

type RefundStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED";

const refundMeta: Record<RefundStatus, { label: string; classes: string }> = {
  PENDING_APPROVAL: {
    label: "Pending Approval",
    classes: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  },
  APPROVED: {
    label: "Approved",
    classes: "bg-green-50 text-green-700 border border-green-200",
  },
  REJECTED: {
    label: "Rejected",
    classes: "bg-red-50 text-red-700 border border-red-200",
  },
  COMPLETED: {
    label: "Disbursed",
    classes: "bg-neutral-100 text-neutral-600 border border-neutral-200",
  },
};

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const meta = refundMeta[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}

// ── Extension Status Badge ────────────────────────────────────────────────────

const extensionMeta: Record<ExtensionStatus, { label: string; classes: string }> = {
  PENDING_PAYMENT: {
    label: "Awaiting Payment",
    classes: "bg-orange-50 text-orange-700 border border-orange-200",
  },
  PAYMENT_COLLECTED: {
    label: "Cash Collected",
    classes: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  },
  CONFIRMED: {
    label: "Confirmed",
    classes: "bg-green-50 text-green-700 border border-green-200",
  },
  REJECTED: {
    label: "Rejected",
    classes: "bg-red-50 text-red-700 border border-red-200",
  },
  CANCELLED: {
    label: "Cancelled",
    classes: "bg-neutral-100 text-neutral-600 border border-neutral-200",
  },
};

export function ExtensionStatusBadge({ status }: { status: ExtensionStatus }) {
  const meta = extensionMeta[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${meta.classes}`}
    >
      {meta.label}
    </span>
  );
}
