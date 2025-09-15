"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { CreateJobModal } from "@/components/features/labor/create-job-modal";

type JobCategory = { category_id: number; name: string; description: string | null; current_hourly_rate: number };
type Job = { job_id: number; name: string; description: string | null; category_id: number };

export default function AddJobDialog({
  productId,
  open,
  onOpenChange,
  onApplied,
}: {
  productId: number;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onApplied?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const actualOpen = typeof open === "boolean" ? (open as boolean) : localOpen;
  const setOpenState = (v: boolean) => (typeof open === "boolean" ? onOpenChange?.(v) : setLocalOpen(v));

  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [payType, setPayType] = useState<"hourly" | "piece">("hourly");
  const [timeRequired, setTimeRequired] = useState<number>(1);
  const [timeUnit, setTimeUnit] = useState<"hours" | "minutes" | "seconds">("minutes");
  const [quantity, setQuantity] = useState<number>(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!actualOpen) return;
    void loadCategories();
  }, [actualOpen]);

  useEffect(() => {
    if (!selectedCategoryId) { setJobs([]); return; }
    void loadJobs(selectedCategoryId);
  }, [selectedCategoryId]);

  async function loadCategories() {
    const { data } = await supabase.from("job_categories").select("*").order("name");
    setCategories((data as JobCategory[]) || []);
  }

  async function loadJobs(categoryId: number) {
    const { data } = await supabase
      .from("jobs")
      .select("job_id, name, description, category_id")
      .eq("category_id", categoryId)
      .order("name");
    setJobs((data as Job[]) || []);
  }

  function resetForm() {
    setSelectedCategoryId(null);
    setSelectedJobId(null);
    setPayType("hourly");
    setTimeRequired(1);
    setTimeUnit("minutes");
    setQuantity(1);
  }

  async function add() {
    if (!selectedJobId) return;
    const today = new Date().toISOString().split("T")[0];
    try {
      let insertData: any = {
        product_id: productId,
        job_id: selectedJobId,
        quantity,
      };
      if (payType === "hourly") {
        const { data: rates, error } = await supabase
          .from("job_hourly_rates")
          .select("*")
          .eq("job_id", selectedJobId)
          .lte("effective_date", today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order("effective_date", { ascending: false })
          .limit(1);
        if (error) throw error;
        const hourlyRateId = rates && rates.length > 0 ? rates[0].rate_id : null;
        insertData = {
          ...insertData,
          pay_type: "hourly",
          time_required: timeRequired,
          time_unit: timeUnit,
          hourly_rate_id: hourlyRateId,
          piece_rate_id: null,
        };
      } else {
        const { data: prates, error: prErr } = await supabase
          .from("piece_work_rates")
          .select("rate_id, job_id, product_id, rate, effective_date, end_date")
          .eq("job_id", selectedJobId)
          .lte("effective_date", today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order("effective_date", { ascending: false });
        if (prErr) throw prErr;
        const chosen = (prates || []).find((r: any) => r.product_id === productId) || (prates || []).find((r: any) => r.product_id == null) || null;
        const pieceRateId = chosen ? chosen.rate_id : null;
        insertData = {
          ...insertData,
          pay_type: "piece",
          time_required: null,
          time_unit: "hours",
          rate_id: null,
          piece_rate_id: pieceRateId,
        };
      }
      const { error: insErr } = await supabase.from("billoflabour").insert(insertData);
      if (insErr) throw insErr;
      setOpenState(false);
      resetForm();
      onApplied?.();
    } catch (e) {
      console.error("Add job failed", e);
      alert("Failed to add job");
    }
  }

  return (
    <>
      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenState(false)} />
          <div className="relative bg-background border rounded-md shadow-xl w-[820px] max-h-[80vh] overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Job</h2>
              <Button variant="ghost" onClick={() => setOpenState(false)}>Close</Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium mb-2">Job Category</div>
                <Select value={selectedCategoryId?.toString() || ""} onValueChange={(v) => setSelectedCategoryId(v ? Number(v) : null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.category_id} value={String(c.category_id)}>
                        {c.name} - R{c.current_hourly_rate.toFixed(2)}/hr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Job</div>
                <Select value={selectedJobId?.toString() || ""} onValueChange={(v) => setSelectedJobId(v ? Number(v) : null)} disabled={!selectedCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select job" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map(j => (
                      <SelectItem key={j.job_id} value={String(j.job_id)}>{j.name}</SelectItem>
                    ))}
                    <div className="p-2 border-t">
                      <Button variant="outline" size="sm" className="w-full" onClick={(e) => { e.preventDefault(); setCreateOpen(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create new job
                      </Button>
                    </div>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Pay Type</div>
                <Select value={payType} onValueChange={(v: any) => setPayType(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pay type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="piece">Piecework</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium mb-2">Time Required</div>
                  <Input type="number" min="0.01" step="0.01" value={timeRequired} onChange={(e) => setTimeRequired(Math.max(0.01, Number(e.target.value)))} disabled={payType === "piece"} />
                </div>
                <div className="w-40">
                  <div className="text-sm font-medium mb-2">Unit</div>
                  <Select value={timeUnit} onValueChange={(v: any) => setTimeUnit(v)} disabled={payType === "piece"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="seconds">Seconds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Quantity</div>
                <Input type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={add} disabled={!selectedJobId}>Add Job</Button>
            </div>
          </div>
        </div>
      )}

      <CreateJobModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onJobCreated={(j) => {
          setCreateOpen(false);
          setSelectedCategoryId(j.category_id);
          setSelectedJobId(j.job_id);
          void loadJobs(j.category_id);
        }}
        initialCategoryId={selectedCategoryId || undefined}
      />
    </>
  );
}
