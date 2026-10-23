/**
 * Branch Manager "Financials" sub-tab (Oct 2026): every payment collected in the
 * branch, split into the six client payment types (payment-type.ts), with summary
 * cards, a paged table and an export — all from ONE filter set.
 *
 * Read-only. Everything is aggregated in SQL: a transaction row is expanded into
 * one row per payment type it paid for (a drop payment of ₹700 = Late fee ₹160 +
 * Extra charges ₹540), so cards, table total and export always agree.
 *
 * Indexed path: PaymentTransaction ("branchId", COALESCE("collectedAt","createdAt"))
 * (migration 20261028090000_financials_paid_at_index); the allocation lookups use the
 * unique LedgerEntry.idempotencyKey, LedgerEntry.sessionId, PaymentSession.bookingId
 * and ChargeEntry.bookingId indexes.
 */
import { z } from "zod";
import { DateTime } from "luxon";
import { prisma, Prisma } from "@repo/database/client";
import { SYSTEM_TIMEZONE } from "../timezone/timezone.service.js";
import { resolveIstPeriod, PeriodRangeError } from "../../utils/reporting/istPeriod.js";
import {
  ALLOCATABLE_CHARGE_TYPES,
  ALLOCATABLE_LEDGER_TYPES,
  CLIENT_PAYMENT_TYPES,
  CLIENT_PAYMENT_TYPE_LABELS,
  COLLECTED_PURPOSES,
  COLLECTED_STATUSES,
  GATEWAY_REGEX,
  chargeCaseSql,
  ledgerCaseSql,
  paymentModeLabel,
  purposeCaseSql,
  sqlList,
  typeOrderCaseSql,
  type ClientPaymentType,
  type PaymentAllocation,
  type PaymentModeKey,
} from "./payment-type.js";

// ── Filters ───────────────────────────────────────────────────────────────────

export const FINANCIALS_SORTS = ["date", "amount", "type"] as const;
export const SHIFT_STATUS_FILTERS = ["OPEN", "CLOSED", "NONE"] as const;
export const PAYMENT_MODE_KEYS = ["CASH", "UPI", "GATEWAY"] as const;
/** `collectedBy` value for payments no staff member took (online, by the customer). */
export const COLLECTED_BY_ONLINE = "ONLINE";
export const MAX_PAGE_SIZE = 100;
/** Export cap (rows after the split into types). A busy branch's year is well below it; above it the export is refused. */
export const MAX_EXPORT_ROWS = 200_000;

export interface FinancialsFilter {
  branchId: number;
  from: string;
  to: string;
  start: Date;
  end: Date;
  /** empty = all types */
  types: ClientPaymentType[];
  /** empty = all modes; a split row matches each of its modes */
  modes: PaymentModeKey[];
  /** collector User.publicId, COLLECTED_BY_ONLINE, or null = everyone */
  collectedBy: string | null;
  /** OPEN, CLOSED (closed or flagged), NONE (no shift) or null = any */
  shiftStatus: (typeof SHIFT_STATUS_FILTERS)[number] | null;
  search: string | null;
  sort: (typeof FINANCIALS_SORTS)[number];
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v);

/** `a,b` or repeated params → upper-case list; "all" / empty → []. */
const csvList = (v: unknown): string[] => {
  const raw = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  const items = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return items.includes("ALL") ? [] : [...new Set(items)];
};

const querySchema = z.object({
  from: z.preprocess(blank, z.string().regex(DATE, "'from' must be a date in YYYY-MM-DD format").optional()),
  to: z.preprocess(blank, z.string().regex(DATE, "'to' must be a date in YYYY-MM-DD format").optional()),
  types: z.preprocess(
    csvList,
    z.array(z.enum(CLIENT_PAYMENT_TYPES, { message: `'types' must be from ${CLIENT_PAYMENT_TYPES.join(", ")}` })),
  ),
  modes: z.preprocess(
    csvList,
    z.array(z.enum(PAYMENT_MODE_KEYS, { message: "'modes' must be from CASH, UPI, GATEWAY" })),
  ),
  collectedBy: z.preprocess(blank, z.string().max(64).optional()),
  shiftStatus: z.preprocess(
    (v) => {
      const s = blank(v);
      return typeof s === "string" ? (s.toLowerCase() === "all" ? undefined : s.toUpperCase()) : s;
    },
    z.enum(SHIFT_STATUS_FILTERS, { message: "'shiftStatus' must be OPEN, CLOSED or NONE" }).optional(),
  ),
  search: z.preprocess(blank, z.string().max(100, "'search' can be at most 100 characters").optional()),
  sort: z.preprocess(
    (v) => (typeof blank(v) === "string" ? String(blank(v)).toLowerCase() : blank(v)),
    z.enum(FINANCIALS_SORTS, { message: "'sort' must be date, amount or type" }).default("date"),
  ),
  dir: z.preprocess(
    (v) => (typeof blank(v) === "string" ? String(blank(v)).toLowerCase() : blank(v)),
    z.enum(["asc", "desc"], { message: "'dir' must be asc or desc" }).default("desc"),
  ),
  page: z.preprocess(blank, z.coerce.number().int().min(1, "'page' must be 1 or more").default(1)),
  pageSize: z.preprocess(
    blank,
    z.coerce
      .number()
      .int()
      .min(1, `'pageSize' must be between 1 and ${MAX_PAGE_SIZE}`)
      .max(MAX_PAGE_SIZE, `'pageSize' must be between 1 and ${MAX_PAGE_SIZE}`)
      .default(25),
  ),
});

export type ParseResult =
  | { ok: true; filter: FinancialsFilter }
  | { ok: false; code: string; message: string; errors?: { field: string; message: string }[] };

/**
 * Query string → filter. No dates ⇒ today (IST). Dates are IST calendar days of the
 * date collected; `to` before `from` and ranges over 366 days are refused.
 */
export function parseFinancialsQuery(query: unknown, branchId: number, now: DateTime = DateTime.now()): ParseResult {
  const parsed = querySchema.safeParse(query ?? {});
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    return { ok: false, code: "INVALID_FINANCIALS_QUERY", message: errors[0]?.message ?? "Invalid filters.", errors };
  }
  const q = parsed.data;
  const today = now.setZone(SYSTEM_TIMEZONE).toFormat("yyyy-MM-dd");
  let period;
  try {
    period = resolveIstPeriod({ from: q.from ?? (q.to ? undefined : today), to: q.to ?? (q.from ? undefined : today), now });
  } catch (err) {
    if (err instanceof PeriodRangeError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
  return {
    ok: true,
    filter: {
      branchId,
      from: period.from,
      to: period.to,
      start: period.start,
      end: period.end,
      types: q.types,
      modes: q.modes,
      collectedBy: q.collectedBy ?? null,
      shiftStatus: q.shiftStatus ?? null,
      search: q.search ?? null,
      sort: q.sort,
      dir: q.dir,
      page: q.page,
      pageSize: q.pageSize,
    },
  };
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const raw = Prisma.raw;
const PAID_AT = `COALESCE(t."collectedAt", t."createdAt")`;

/** `%term%` with LIKE wildcards in the term escaped. */
export const likePattern = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** WHERE of the transaction scan: branch, collected status/purpose, IST range + the row-level filters. */
export function transactionWhereSql(f: FinancialsFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`t."branchId" = ${f.branchId}`,
    raw(`t.status::text IN (${sqlList(COLLECTED_STATUSES)})`),
    raw(`t.purpose::text IN (${sqlList(COLLECTED_PURPOSES)})`),
    Prisma.sql`${raw(PAID_AT)} >= ${f.start}`,
    Prisma.sql`${raw(PAID_AT)} <= ${f.end}`,
  ];
  if (f.collectedBy === COLLECTED_BY_ONLINE) {
    parts.push(raw(`t."collectedById" IS NULL`));
  } else if (f.collectedBy) {
    parts.push(Prisma.sql`t."collectedById" = (SELECT u.id FROM "User" u WHERE u."publicId" = ${f.collectedBy})`);
  }
  if (f.shiftStatus === "NONE") {
    parts.push(raw(`t."cashShiftId" IS NULL`));
  } else if (f.shiftStatus === "OPEN") {
    parts.push(raw(`EXISTS (SELECT 1 FROM "CashShift" cs WHERE cs.id = t."cashShiftId" AND cs.status::text = 'OPEN')`));
  } else if (f.shiftStatus === "CLOSED") {
    parts.push(raw(`EXISTS (SELECT 1 FROM "CashShift" cs WHERE cs.id = t."cashShiftId" AND cs.status::text <> 'OPEN')`));
  }
  if (f.search) {
    const like = likePattern(f.search);
    const compact = likePattern(f.search.replace(/[\s-]/g, ""));
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "Booking" sb
      JOIN "Customer" sc ON sc.id = sb."customerId"
      JOIN "User" su ON su.id = sc."userId"
      WHERE sb.id = t."bookingId" AND (
        sb."publicId" ILIKE ${like}
        OR su.name ILIKE ${like}
        OR su.phone ILIKE ${like}
        OR COALESCE(sc."alternatePhone", '') ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM "BookingItem" sbi JOIN "Vehicle" sv ON sv.id = sbi."vehicleId"
          WHERE sbi."bookingId" = sb.id
            AND (sv."regNo" ILIKE ${like} OR REPLACE(REPLACE(sv."regNo", ' ', ''), '-', '') ILIKE ${compact})
        )
      ))`);
  }
  return Prisma.join(parts, " AND ");
}

/** Mode filter on the normalised cash / online parts (CTE `b`); empty sql when all modes. */
export function modeWhereSql(f: FinancialsFilter): Prisma.Sql {
  if (f.modes.length === 0 || f.modes.length === PAYMENT_MODE_KEYS.length) return raw("TRUE");
  const ors = f.modes.map((m) =>
    m === "CASH"
      ? "cash_part > 0"
      : m === "UPI"
        ? "(total - cash_part > 0 AND NOT is_gateway)"
        : "(total - cash_part > 0 AND is_gateway)",
  );
  return raw(`(${ors.join(" OR ")})`);
}

/** Type filter on the allocated rows; TRUE when all types. */
export function typeWhereSql(f: FinancialsFilter, alias = ""): Prisma.Sql {
  if (f.types.length === 0 || f.types.length === CLIENT_PAYMENT_TYPES.length) return raw("TRUE");
  return raw(`${alias}type IN (${sqlList(f.types)})`);
}

/** ORDER BY for the allocated rows (newest first by default; stable tiebreaks). */
export function orderBySql(f: FinancialsFilter, alias = ""): Prisma.Sql {
  const d = f.dir === "asc" ? "ASC" : "DESC";
  const a = alias;
  const keys =
    f.sort === "amount"
      ? [`${a}amount ${d}`, `${a}paid_at DESC`, `${a}id DESC`, `${a}type_ord ASC`]
      : f.sort === "type"
        ? [`${a}type_ord ${d}`, `${a}paid_at DESC`, `${a}id DESC`]
        : [`${a}paid_at ${d}`, `${a}id ${d}`, `${a}type_ord ASC`];
  return raw(keys.join(", "));
}

/**
 * The CTE chain ending in `alloc`: one row per (transaction, payment type) with the
 * allocated amount / cash / upi / gateway. Every filter except the type filter is
 * applied, so `alloc` also gives the per-type counts for the date range.
 * `txnIds` restricts it to given transactions instead (loadPaymentAllocations).
 */
export function allocationCteSql(where: Prisma.Sql, modeWhere: Prisma.Sql = raw("TRUE")): Prisma.Sql {
  const ord = typeOrderCaseSql("p.type");
  return Prisma.sql`
WITH base AS (
  SELECT t.id, t."publicId" AS txn_public_id, t."idempotencyKey" AS idem, t."bookingId" AS booking_id,
         t.purpose::text AS purpose, t.method::text AS method, t.status::text AS status,
         t."totalAmount" AS total, t."onlineGateway" AS online_gateway, t."onlineTransactionRef" AS online_ref,
         t."collectedById" AS collected_by_id, t."cashShiftId" AS cash_shift_id,
         t."proofFileId" AS proof_file_id, t.notes,
         ${raw(PAID_AT)} AS paid_at,
         (CASE WHEN t."cashAmount" + t."onlineAmount" = t."totalAmount" THEN t."cashAmount"
               WHEN t.method::text = 'CASH' THEN t."totalAmount"
               WHEN t.method::text = 'ONLINE' THEN 0::numeric
               ELSE LEAST(t."cashAmount", t."totalAmount") END) AS cash_part,
         (t."onlineGateway" IS NOT NULL AND t."onlineGateway" ~* ${raw(`'${GATEWAY_REGEX}'`)}) AS is_gateway
  FROM "PaymentTransaction" t
  WHERE ${where}
),
b AS (
  SELECT base.*, base.total - base.cash_part AS online_part FROM base WHERE ${modeWhere}
),
src AS (
  SELECT b.id, b.booking_id, b.paid_at,
    COALESCE(
      (SELECT le."sessionId" FROM "LedgerEntry" le
        WHERE b.idem LIKE 'pt:%' AND le."idempotencyKey" = SUBSTRING(b.idem FROM 4) LIMIT 1),
      (SELECT s.id FROM "PaymentSession" s
        WHERE s."bookingId" = b.booking_id AND s."sessionType"::text = 'RETURN'
          AND s.status::text = 'COMPLETED' AND s."completedAt" <= b.paid_at
        ORDER BY s."completedAt" DESC LIMIT 1)
    ) AS session_id
  FROM b WHERE b.purpose = 'REMAINING_BALANCE'
),
w AS (
  SELECT src.id, ${raw(ledgerCaseSql(`e."entryType"::text`, `e."referenceType"`))} AS type, SUM(e.amount) AS weight
  FROM src JOIN "LedgerEntry" e ON e."sessionId" = src.session_id
  WHERE src.session_id IS NOT NULL AND NOT e."isVoided" AND e.amount > 0
    AND e."entryType"::text IN (${raw(sqlList(ALLOCATABLE_LEDGER_TYPES))})
  GROUP BY 1, 2
  UNION ALL
  SELECT src.id, ${raw(chargeCaseSql(`ce."chargeType"::text`))} AS type, SUM(ce."finalAmount") AS weight
  FROM src JOIN "ChargeEntry" ce ON ce."bookingId" = src.booking_id
  WHERE src.session_id IS NULL AND ce."finalAmount" > 0 AND ce."createdAt" <= src.paid_at
    AND ce."chargeType"::text IN (${raw(sqlList(ALLOCATABLE_CHARGE_TYPES))})
  GROUP BY 1, 2
),
parts AS (
  SELECT w.id, w.type, w.weight::numeric AS weight FROM w
  UNION ALL
  SELECT b.id, ${raw(purposeCaseSql("b.purpose"))} AS type, 1::numeric AS weight
  FROM b WHERE NOT EXISTS (SELECT 1 FROM w WHERE w.id = b.id)
),
a0 AS (
  SELECT b.*, p.type, ${raw(ord)} AS type_ord, p.weight,
         SUM(p.weight) OVER (PARTITION BY b.id ORDER BY ${raw(ord)} ROWS UNBOUNDED PRECEDING) AS cum_w,
         SUM(p.weight) OVER (PARTITION BY b.id) AS tot_w,
         COUNT(*) OVER (PARTITION BY b.id) AS part_count
  FROM b JOIN parts p ON p.id = b.id
),
a1 AS (
  SELECT a0.*,
    (ROUND(a0.cash_part * 100 * a0.cum_w / a0.tot_w) - ROUND(a0.cash_part * 100 * (a0.cum_w - a0.weight) / a0.tot_w)) / 100 AS cash,
    (ROUND(a0.online_part * 100 * a0.cum_w / a0.tot_w) - ROUND(a0.online_part * 100 * (a0.cum_w - a0.weight) / a0.tot_w)) / 100 AS online
  FROM a0
),
alloc AS (
  SELECT a1.*, a1.cash + a1.online AS amount,
         CASE WHEN a1.is_gateway THEN 0::numeric ELSE a1.online END AS upi,
         CASE WHEN a1.is_gateway THEN a1.online ELSE 0::numeric END AS gateway
  FROM a1
)`;
}

export function financialsCteSql(f: FinancialsFilter): Prisma.Sql {
  return allocationCteSql(transactionWhereSql(f), modeWhereSql(f));
}

/** Per type over the filtered range (type filter NOT applied: the counts in the type picker). */
export function aggregateSql(f: FinancialsFilter): Prisma.Sql {
  return Prisma.sql`${financialsCteSql(f)}
SELECT type, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(cash), 0) AS cash,
       COALESCE(SUM(upi), 0) AS upi, COALESCE(SUM(gateway), 0) AS gateway
FROM alloc GROUP BY type`;
}

/** One page (or, with limit null, every row) of the filtered rows with their display joins. */
export function rowsSql(f: FinancialsFilter, limit: number | null, offset = 0): Prisma.Sql {
  // Export: one row over the cap tells the caller it was too many
  const pageClause = limit == null ? Prisma.sql`LIMIT ${MAX_EXPORT_ROWS + 1}` : Prisma.sql`LIMIT ${limit} OFFSET ${offset}`;
  return Prisma.sql`${financialsCteSql(f)},
pg AS (
  SELECT * FROM alloc WHERE ${typeWhereSql(f)} ORDER BY ${orderBySql(f)} ${pageClause}
)
SELECT pg.id, pg.txn_public_id, pg.purpose, pg.method, pg.status, pg.total, pg.online_gateway, pg.online_ref,
       pg.proof_file_id, pg.notes, pg.paid_at, pg.type, pg.type_ord, pg.part_count::int AS part_count,
       pg.amount, pg.cash, pg.online, pg.upi, pg.gateway, pg.cash_part, pg.online_part,
       bk."publicId" AS booking_public_id, cu."publicId" AS customer_public_id,
       u.name AS customer_name, u.phone AS customer_phone,
       (SELECT STRING_AGG(v."regNo", ', ' ORDER BY bi.id) FROM "BookingItem" bi JOIN "Vehicle" v ON v.id = bi."vehicleId"
         WHERE bi."bookingId" = bk.id) AS vehicle_reg,
       (SELECT STRING_AGG(v.make || ' ' || v.model, ', ' ORDER BY bi.id) FROM "BookingItem" bi JOIN "Vehicle" v ON v.id = bi."vehicleId"
         WHERE bi."bookingId" = bk.id) AS vehicle_name,
       col."publicId" AS collector_public_id, col.name AS collector_name,
       sh."publicId" AS shift_public_id, sh.status::text AS shift_status,
       (pg.proof_file_id IS NOT NULL OR EXISTS (SELECT 1 FROM "PaymentTransactionProof" pp WHERE pp."transactionId" = pg.id)) AS has_proof
FROM pg
JOIN "Booking" bk ON bk.id = pg.booking_id
JOIN "Customer" cu ON cu.id = bk."customerId"
JOIN "User" u ON u.id = cu."userId"
LEFT JOIN "User" col ON col.id = pg.collected_by_id
LEFT JOIN "CashShift" sh ON sh.id = pg.cash_shift_id
ORDER BY ${orderBySql(f, "pg.")}`;
}

// ── Running the queries ───────────────────────────────────────────────────────

const num = (v: unknown): number => (v == null ? 0 : Math.round(Number(v) * 100) / 100);

export interface TypeCard {
  type: ClientPaymentType;
  label: string;
  /** for the selected filters (0 for a type that is filtered out) */
  amount: number;
  count: number;
  /** rows of this type for the date range + other filters, ignoring the type filter */
  countInRange: number;
  amountInRange: number;
}

export interface ModeSplit {
  cash: number;
  upi: number;
  gateway: number;
}

export interface FinancialsSummary {
  total: { amount: number; count: number };
  byType: TypeCard[];
  byMode: ModeSplit;
}

export interface FinancialsRow {
  /** `<transaction publicId>:<type>` — one transaction can be split over several types */
  id: string;
  transactionId: string;
  paidAt: string;
  type: ClientPaymentType;
  typeLabel: string;
  amount: number;
  cash: number;
  upi: number;
  gateway: number;
  mode: string;
  method: string;
  status: string;
  purpose: string;
  /** the whole transaction (all its types) */
  transactionTotal: number;
  transactionCash: number;
  transactionOnline: number;
  /** how many types the transaction was split over */
  partCount: number;
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicle: string;
  vehicleName: string;
  collectedBy: { id: string; name: string } | null;
  shift: { id: string; status: string; isOpen: boolean } | null;
  reference: string | null;
  onlineGateway: string | null;
  hasProof: boolean;
  notes: string | null;
}

export async function getFinancialsSummary(f: FinancialsFilter): Promise<FinancialsSummary> {
  const rows = await prisma.$queryRaw<
    { type: ClientPaymentType; count: number; amount: unknown; cash: unknown; upi: unknown; gateway: unknown }[]
  >(aggregateSql(f));
  const selected = (t: ClientPaymentType) => f.types.length === 0 || f.types.includes(t);
  const byType: TypeCard[] = CLIENT_PAYMENT_TYPES.map((type) => {
    const r = rows.find((x) => x.type === type);
    const on = selected(type);
    return {
      type,
      label: CLIENT_PAYMENT_TYPE_LABELS[type],
      amount: on && r ? num(r.amount) : 0,
      count: on && r ? Number(r.count) : 0,
      countInRange: r ? Number(r.count) : 0,
      amountInRange: r ? num(r.amount) : 0,
    };
  });
  const byMode: ModeSplit = { cash: 0, upi: 0, gateway: 0 };
  let amount = 0;
  let count = 0;
  for (const r of rows) {
    if (!selected(r.type)) continue;
    amount += num(r.amount);
    count += Number(r.count);
    byMode.cash += num(r.cash);
    byMode.upi += num(r.upi);
    byMode.gateway += num(r.gateway);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    total: { amount: r2(amount), count },
    byType,
    byMode: { cash: r2(byMode.cash), upi: r2(byMode.upi), gateway: r2(byMode.gateway) },
  };
}

type RawRow = Record<string, unknown>;

function toRow(r: RawRow): FinancialsRow {
  const type = r.type as ClientPaymentType;
  const cash = num(r.cash);
  const online = num(r.online);
  const gw = (r.online_gateway as string | null) ?? null;
  const shiftStatus = (r.shift_status as string | null) ?? null;
  return {
    id: `${r.txn_public_id}:${type}`,
    transactionId: String(r.txn_public_id),
    paidAt: (r.paid_at as Date).toISOString(),
    type,
    typeLabel: CLIENT_PAYMENT_TYPE_LABELS[type],
    amount: num(r.amount),
    cash,
    upi: num(r.upi),
    gateway: num(r.gateway),
    mode: paymentModeLabel({ cash: num(r.cash_part), online: num(r.online_part), onlineGateway: gw }),
    method: String(r.method),
    status: String(r.status),
    purpose: String(r.purpose),
    transactionTotal: num(r.total),
    transactionCash: num(r.cash_part),
    transactionOnline: num(r.online_part),
    partCount: Number(r.part_count ?? 1),
    bookingId: String(r.booking_public_id),
    customerId: String(r.customer_public_id),
    customerName: String(r.customer_name ?? ""),
    customerPhone: String(r.customer_phone ?? ""),
    vehicle: String(r.vehicle_reg ?? ""),
    vehicleName: String(r.vehicle_name ?? ""),
    collectedBy: r.collector_public_id ? { id: String(r.collector_public_id), name: String(r.collector_name ?? "") } : null,
    shift: r.shift_public_id
      ? { id: String(r.shift_public_id), status: String(shiftStatus), isOpen: shiftStatus === "OPEN" }
      : null,
    reference: (r.online_ref as string | null) ?? null,
    onlineGateway: gw,
    hasProof: Boolean(r.has_proof),
    notes: (r.notes as string | null) ?? null,
  };
}

export async function listFinancialsRows(f: FinancialsFilter): Promise<FinancialsRow[]> {
  const rows = await prisma.$queryRaw<RawRow[]>(rowsSql(f, f.pageSize, (f.page - 1) * f.pageSize));
  return rows.map(toRow);
}

export class ExportTooLargeError extends Error {
  constructor() {
    super(`More than ${MAX_EXPORT_ROWS.toLocaleString("en-IN")} rows — narrow the date range or filters to export.`);
  }
}

export async function exportFinancialsRows(f: FinancialsFilter): Promise<FinancialsRow[]> {
  const rows = await prisma.$queryRaw<RawRow[]>(rowsSql(f, null));
  if (rows.length > MAX_EXPORT_ROWS) throw new ExportTooLargeError();
  return rows.map(toRow);
}

/** Staff who collected payments in the branch (the "Fleet member" filter). */
export async function listCollectors(branchId: number): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
    SELECT u."publicId" AS id, u.name
    FROM "User" u
    WHERE EXISTS (SELECT 1 FROM "PaymentTransaction" t WHERE t."collectedById" = u.id AND t."branchId" = ${branchId})
    ORDER BY u.name`);
  return rows;
}

/**
 * The six-type split of given PaymentTransactions (same SQL as the Financials view, so a
 * shift-close breakdown matches the cards). Transactions that are not collected money
 * (refunds, voided, rejected …) get no entry.
 */
export async function loadPaymentAllocations(
  db: { $queryRaw: typeof prisma.$queryRaw },
  txnIds: number[],
): Promise<Map<number, PaymentAllocation[]>> {
  const out = new Map<number, PaymentAllocation[]>();
  if (txnIds.length === 0) return out;
  const where = Prisma.sql`t.id IN (${Prisma.join(txnIds)})
    AND t.status::text IN (${raw(sqlList(COLLECTED_STATUSES))})
    AND t.purpose::text IN (${raw(sqlList(COLLECTED_PURPOSES))})`;
  const rows = await db.$queryRaw<{ id: number; type: ClientPaymentType; cash: unknown; online: unknown }[]>(
    Prisma.sql`${allocationCteSql(where)} SELECT id, type, cash, online FROM alloc ORDER BY id, type_ord`,
  );
  for (const r of rows) {
    const list = out.get(r.id) ?? [];
    const cash = num(r.cash);
    const online = num(r.online);
    list.push({ type: r.type, amount: Math.round((cash + online) * 100) / 100, cash, online });
    out.set(r.id, list);
  }
  return out;
}
