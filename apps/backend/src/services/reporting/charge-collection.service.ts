/**
 * Charged vs collected, per booking and client payment type (Admin Reports 3.5, shared
 * with rpt-fleet for extra km / damages). Read-only, two SQL statements per chunk.
 *
 * CHARGED — what the bills recorded for the type, per booking:
 *   - the booking's non-voided LedgerEntry lines of the type (Unified Payments drop bill,
 *     plus the signed delta lines an ADJUSTMENT session wrote when the drop was edited);
 *   - else, when the booking has NO ledger line of that type, its legacy ChargeEntry rows
 *     of the type (pre-ledger drops / legacy CompleteReturn). Ledger first, so a booking
 *     carrying both is never counted twice.
 *   Types come from payment-type.ts (EXTRA_TIME + GRACE_ADJUSTMENT → LATE_FEE, …).
 *
 * COLLECTED — the money received for the type:
 *   (a) payments: every COLLECTED / CONFIRMED payment on the booking split over its bill
 *       lines exactly as the Branch Manager Financials view does (allocationCteSql in
 *       financials-query.ts);
 *   (b) deposit set-off: on a drop bill with SET_OFF the held safety deposit pays the
 *       charges without any payment row. The part used (PaymentSession.metadata.deposit
 *       .setOff of the booking's latest COMPLETED RETURN session) is split over that
 *       session's positive charge lines in proportion, rounded to the paise.
 *   Not counted: legacy (pre-ledger) drops that set the deposit off (no amount recorded
 *   per line), and refunds paid out later (never allocated to a type in the system).
 *
 * difference = charged − collected (positive = still owed / written off).
 */
import { prisma, Prisma } from "@repo/database/client";
import { allocationCteSql } from "../financials/financials-query.js";
import {
  ALLOCATABLE_CHARGE_TYPES,
  ALLOCATABLE_LEDGER_TYPES,
  COLLECTED_PURPOSES,
  COLLECTED_STATUSES,
  chargeCaseSql,
  ledgerCaseSql,
  sqlList,
  type ClientPaymentType,
} from "../financials/payment-type.js";

export interface ChargedCollected {
  charged: number;
  /** payments + deposit set-off */
  collected: number;
  /** of which: the safety deposit set off on the drop bill */
  fromDeposit: number;
}

export type ChargedCollectedByType = Partial<Record<ClientPaymentType, ChargedCollected>>;

const raw = Prisma.raw;
const CHUNK = 5000;
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const r2 = (n: number): number => Math.round(n * 100) / 100;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** SQL for the charged amounts of the given bookings (ledger first, legacy ChargeEntry fallback). */
export function chargedSql(bookingIds: number[]): Prisma.Sql {
  const ids = Prisma.join(bookingIds);
  return Prisma.sql`
WITH l AS (
  SELECT e."bookingId" AS booking_id, ${raw(ledgerCaseSql(`e."entryType"::text`, `e."referenceType"`))} AS type,
         SUM(e.amount) AS amount
  FROM "LedgerEntry" e
  WHERE e."bookingId" IN (${ids}) AND NOT e."isVoided"
    AND e."entryType"::text IN (${raw(sqlList(ALLOCATABLE_LEDGER_TYPES))})
  GROUP BY 1, 2
),
c AS (
  SELECT ce."bookingId" AS booking_id, ${raw(chargeCaseSql(`ce."chargeType"::text`))} AS type,
         SUM(ce."finalAmount") AS amount
  FROM "ChargeEntry" ce
  WHERE ce."bookingId" IN (${ids})
    AND ce."chargeType"::text IN (${raw(sqlList(ALLOCATABLE_CHARGE_TYPES))})
  GROUP BY 1, 2
)
SELECT booking_id, type, amount FROM l
UNION ALL
SELECT c.booking_id, c.type, c.amount FROM c
WHERE NOT EXISTS (SELECT 1 FROM l WHERE l.booking_id = c.booking_id AND l.type = c.type)`;
}

/** SQL for the collected amounts per (booking, type), Financials allocation. */
export function collectedSql(bookingIds: number[]): Prisma.Sql {
  const where = Prisma.sql`t."bookingId" IN (${Prisma.join(bookingIds)})
    AND t.status::text IN (${raw(sqlList(COLLECTED_STATUSES))})
    AND t.purpose::text IN (${raw(sqlList(COLLECTED_PURPOSES))})`;
  return Prisma.sql`${allocationCteSql(where)}
SELECT booking_id, type, SUM(amount) AS amount FROM alloc GROUP BY 1, 2`;
}

/** SQL for the deposit set-off share per (booking, type) on the latest COMPLETED RETURN session. */
export function depositSetOffSql(bookingIds: number[]): Prisma.Sql {
  return Prisma.sql`
WITH s AS (
  SELECT DISTINCT ON (ps."bookingId") ps.id, ps."bookingId" AS booking_id,
         CASE WHEN (ps.metadata->'deposit'->>'setOff') ~ '^[0-9]+([.][0-9]+)?$'
              THEN (ps.metadata->'deposit'->>'setOff')::numeric ELSE 0 END AS set_off
  FROM "PaymentSession" ps
  WHERE ps."bookingId" IN (${Prisma.join(bookingIds)})
    AND ps."sessionType"::text = 'RETURN' AND ps.status::text = 'COMPLETED'
  ORDER BY ps."bookingId", ps."completedAt" DESC NULLS LAST, ps.id DESC
),
w AS (
  SELECT s.booking_id, s.set_off, ${raw(ledgerCaseSql(`e."entryType"::text`, `e."referenceType"`))} AS type,
         SUM(e.amount) AS weight
  FROM s JOIN "LedgerEntry" e ON e."sessionId" = s.id
  WHERE s.set_off > 0 AND NOT e."isVoided" AND e.amount > 0
    AND e."entryType"::text IN (${raw(sqlList(ALLOCATABLE_LEDGER_TYPES))})
  GROUP BY 1, 2, 3
)
SELECT booking_id, type, ROUND(set_off * weight / SUM(weight) OVER (PARTITION BY booking_id), 2) AS amount
FROM w`;
}

/**
 * Charged vs collected for the given bookings, restricted to `types`
 * (e.g. ["LATE_FEE"]). Bookings with neither get no entry.
 */
export async function getChargedVsCollectedByBooking(
  bookingIds: number[],
  types: readonly ClientPaymentType[],
): Promise<Map<number, ChargedCollectedByType>> {
  const out = new Map<number, ChargedCollectedByType>();
  if (bookingIds.length === 0 || types.length === 0) return out;
  const wanted = new Set<string>(types);
  const add = (bookingId: number, type: string, field: keyof ChargedCollected, amount: number) => {
    if (!wanted.has(type)) return;
    const entry = out.get(bookingId) ?? {};
    const cell = entry[type as ClientPaymentType] ?? { charged: 0, collected: 0, fromDeposit: 0 };
    cell[field] = r2(cell[field] + amount);
    entry[type as ClientPaymentType] = cell;
    out.set(bookingId, entry);
  };
  for (const ids of chunks([...new Set(bookingIds)], CHUNK)) {
    type Row = { booking_id: number; type: string | null; amount: unknown };
    const [charged, collected, deposit] = await Promise.all([
      prisma.$queryRaw<Row[]>(chargedSql(ids)),
      prisma.$queryRaw<Row[]>(collectedSql(ids)),
      prisma.$queryRaw<Row[]>(depositSetOffSql(ids)),
    ]);
    for (const r of charged) if (r.type) add(r.booking_id, r.type, "charged", num(r.amount));
    for (const r of collected) if (r.type) add(r.booking_id, r.type, "collected", num(r.amount));
    for (const r of deposit) {
      if (!r.type) continue;
      add(r.booking_id, r.type, "collected", num(r.amount));
      add(r.booking_id, r.type, "fromDeposit", num(r.amount));
    }
  }
  return out;
}
