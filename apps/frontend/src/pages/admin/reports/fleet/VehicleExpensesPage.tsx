import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import apiClient from "@/lib/axios";
import {
  ExportCsvButton,
  MetricCard,
  ReportFilterBar,
  ReportLayout,
  getReportFilterOptions,
  istToday,
  useReportFilters,
  type ReportFilterOptions,
} from "@/components/admin/reports/framework";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadState, RowTable, Section, istDate, money } from "./fleetShared";

const API = "/admin/dashboard/fleet/expenses";
type Category = "MAINTENANCE" | "REPAIR" | "OTHER";
const CATEGORY_LABELS: Record<Category, string> = { MAINTENANCE: "Maintenance", REPAIR: "Repair", OTHER: "Other" };

interface Expense {
  publicId: string;
  category: Category;
  amount: number;
  incurredAt: string;
  note: string | null;
  createdBy: string | null;
  vehicle: { publicId: string; regNo: string; name: string; branchName: string };
  damageReportId: string | null;
}

interface FormState {
  vehicleId: string;
  category: Category;
  amount: string;
  incurredAt: string;
  note: string;
  damageReportId: string;
}

const emptyForm = (): FormState => ({ vehicleId: "", category: "MAINTENANCE", amount: "", incurredAt: istToday(), note: "", damageReportId: "" });

export function VehicleExpensesPage() {
  const { filters, setFilters, params } = useReportFilters();
  const qc = useQueryClient();
  const [options, setOptions] = useState<ReportFilterOptions | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getReportFilterOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  const q = useQuery({
    queryKey: ["fleet-expenses", params],
    queryFn: async () => (await apiClient.get<{ total: number; items: Expense[] }>(API, { params })).data,
  });

  const save = async () => {
    if (!form.vehicleId) return toast.error("Pick a vehicle");
    if (!(Number(form.amount) > 0)) return toast.error("Enter an amount more than 0");
    setSaving(true);
    try {
      // The date is an IST calendar day: store it at IST noon so it never shifts a day
      const body = { ...form, amount: Number(form.amount), incurredAt: `${form.incurredAt}T12:00:00+05:30`, damageReportId: form.damageReportId || null, note: form.note || null };
      if (editing) await apiClient.patch(`${API}/${editing}`, body);
      else await apiClient.post(API, body);
      toast.success(editing ? "Expense updated" : "Expense recorded");
      setForm(emptyForm());
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["fleet-expenses"] });
      await qc.invalidateQueries({ queryKey: ["fleet-report"] });
    } catch (e) {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Could not save the expense");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await apiClient.delete(`${API}/${id}`);
      toast.success("Expense deleted");
      await qc.invalidateQueries({ queryKey: ["fleet-expenses"] });
      await qc.invalidateQueries({ queryKey: ["fleet-report"] });
    } catch {
      toast.error("Could not delete the expense");
    }
  };

  const edit = (e: Expense) => {
    setEditing(e.publicId);
    setForm({
      vehicleId: e.vehicle.publicId,
      category: e.category,
      amount: String(e.amount),
      incurredAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(e.incurredAt)),
      note: e.note ?? "",
      damageReportId: e.damageReportId ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <ReportLayout
      title="Vehicle Expenses"
      section="4.3"
      description="Record maintenance, repair and other costs per vehicle. Used by Vehicle Profitability and the Damage Report."
      filters={<ReportFilterBar value={filters} onChange={setFilters} />}
      actions={<ExportCsvButton endpoint={API} params={params} filename="vehicle-expenses" />}
      notes={[
        "Only costs entered here (plus any legacy maintenance records) count as recorded costs. Fuel, insurance premiums, EMIs, salaries and anything not entered are not captured.",
        "For a repair, add the damage report ID so the Damage Report can compare repair cost with what was recovered from the customer.",
        "Deleting an expense hides it from reports; the record is kept.",
      ]}
    >
      <section className="rounded-xl border border-neutral-200 bg-white p-4" data-testid="expense-form">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">{editing ? "Edit expense" : "Record an expense"}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm text-neutral-700">
            Vehicle
            <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
              <SelectTrigger className="mt-1 h-10" data-testid="expense-vehicle">
                <SelectValue placeholder="Pick a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {(options?.vehicles ?? []).map((v) => (
                  <SelectItem key={v.publicId} value={v.publicId}>
                    {v.regNo} · {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-sm text-neutral-700">
            Category
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Category })}>
              <SelectTrigger className="mt-1 h-10" data-testid="expense-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-sm text-neutral-700">
            Amount (₹)
            <Input data-testid="expense-amount" className="mt-1 h-10" type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label className="text-sm text-neutral-700">
            Date
            <Input data-testid="expense-date" className="mt-1 h-10" type="date" value={form.incurredAt} onChange={(e) => setForm({ ...form, incurredAt: e.target.value })} />
          </label>
          <label className="text-sm text-neutral-700">
            Damage report ID (repairs, optional)
            <Input data-testid="expense-damage" className="mt-1 h-10" value={form.damageReportId} onChange={(e) => setForm({ ...form, damageReportId: e.target.value.trim() })} />
          </label>
          <label className="text-sm text-neutral-700">
            Note
            <Input data-testid="expense-note" className="mt-1 h-10" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={save} disabled={saving} data-testid="expense-save">
            {editing ? "Save changes" : "Record expense"}
          </Button>
          {editing && (
            <Button variant="outline" onClick={() => { setEditing(null); setForm(emptyForm()); }}>
              Cancel
            </Button>
          )}
        </div>
      </section>

      <LoadState isLoading={q.isLoading} error={q.error} />
      {q.data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Total recorded" value={q.data.total} format="money" hint={`${q.data.items.length} entries in range`} />
          </div>
          <Section title="Expenses">
            <RowTable
              testId="expense-rows"
              rows={q.data.items}
              rowKey={(r) => r.publicId}
              empty="No expenses recorded in this range."
              columns={[
                { header: "Date", cell: (r) => istDate(r.incurredAt) },
                { header: "Reg No", cell: (r) => r.vehicle.regNo },
                { header: "Vehicle", cell: (r) => r.vehicle.name },
                { header: "Branch", cell: (r) => r.vehicle.branchName },
                { header: "Category", cell: (r) => CATEGORY_LABELS[r.category] },
                { header: "Amount", cell: (r) => money(r.amount), align: "right" },
                { header: "Damage report", cell: (r) => r.damageReportId ?? "—" },
                { header: "Note", cell: (r) => r.note ?? "—" },
                { header: "Entered by", cell: (r) => r.createdBy ?? "—" },
                {
                  header: "",
                  cell: (r) => (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r.publicId)}>
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Section>
        </>
      )}
    </ReportLayout>
  );
}

export default VehicleExpensesPage;
