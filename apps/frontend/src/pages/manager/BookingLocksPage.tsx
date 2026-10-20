import { Lock } from "lucide-react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { BookingLocksManager } from "@/components/manager/locks/BookingLocksManager";

/** Booking locks for the manager's branch (e.g. no bookings during a branch closure or a festival). */
export default function BookingLocksPage() {
  return (
    <ManagerLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Lock className="size-6 text-primary" />
            Booking Locks
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Stop new bookings for a date and time window — the whole branch, some vehicles or some vehicle groups.
          </p>
        </div>
        <BookingLocksManager portal={{ kind: "manager" }} />
      </div>
    </ManagerLayout>
  );
}
