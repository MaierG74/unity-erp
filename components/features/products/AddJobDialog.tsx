"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { authorizedFetch } from "@/lib/client/auth-fetch";
import {
  fetchJobCategories,
  type JobCategoryWithRate,
} from "@/lib/client/job-categories";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Search } from "lucide-react";
import { CreateJobModal } from "@/components/features/labor/create-job-modal";

type JobCategory = JobCategoryWithRate;
type Job = { job_id: number; name: string; description: string | null; category_id: number };
type PieceRatePreview = {
  rate_id: number;
  rate: number;
  product_id: number | null;
};

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
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [jobSearch, setJobSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [payType, setPayType] = useState<"hourly" | "piece">("piece");
  const [timeRequired, setTimeRequired] = useState<number>(1);
  const [timeUnit, setTimeUnit] = useState<"hours" | "minutes" | "seconds">("minutes");
  const [quantity, setQuantity] = useState<number>(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [pieceRatePreview, setPieceRatePreview] = useState<PieceRatePreview | null>(null);
  const [isLoadingPieceRate, setIsLoadingPieceRate] = useState(false);

  // Derived: top-level categories and subcategories of selected parent
  const parentCategories = useMemo(
    () => categories.filter(c => c.parent_category_id === null),
    [categories]
  );

  const subcategories = useMemo(
    () => selectedCategoryId
      ? categories.filter(c => c.parent_category_id === selectedCategoryId)
      : [],
    [categories, selectedCategoryId]
  );

  const hasSubcategories = subcategories.length > 0;

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.category_id, category])),
    [categories]
  );

  const jobSearchResults = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    if (!query) return [];

    return allJobs
      .filter((job) => {
        const category = categoryById.get(job.category_id);
        const parentCategory = category?.parent_category_id
          ? categoryById.get(category.parent_category_id)
          : null;

        return [
          job.name,
          job.description,
          category?.name,
          category?.description,
          parentCategory?.name,
          parentCategory?.description,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      })
      .slice(0, 8);
  }, [allJobs, categoryById, jobSearch]);

  useEffect(() => {
    if (!actualOpen) return;
    void loadCategories();
    void loadAllJobs();
  }, [actualOpen]);

  // Load jobs when category/subcategory selection changes
  useEffect(() => {
    if (!selectedCategoryId) { setJobs([]); return; }

    // If there are subcategories and one is selected, load jobs for that subcategory
    if (selectedSubcategoryId) {
      void loadJobs(selectedSubcategoryId);
      return;
    }

    // If no subcategories exist for this parent, load jobs for the parent directly
    // If subcategories exist but none selected, load ALL jobs for parent + subcategories
    const subcatIds = categories
      .filter(c => c.parent_category_id === selectedCategoryId)
      .map(c => c.category_id);

    if (subcatIds.length === 0) {
      void loadJobs(selectedCategoryId);
    } else {
      const allCatIds = [selectedCategoryId, ...subcatIds];
      void loadJobsForCategories(allCatIds);
    }
  }, [selectedCategoryId, selectedSubcategoryId, categories]);

  useEffect(() => {
    if (!selectedJobId || payType !== "piece") {
      setPieceRatePreview(null);
      setIsLoadingPieceRate(false);
      return;
    }

    const request = { cancelled: false };
    void loadPieceRatePreview(selectedJobId, request);

    return () => {
      request.cancelled = true;
    };
  }, [selectedJobId, payType, productId]);

  async function loadCategories() {
    const data = await fetchJobCategories();
    setCategories(data);
  }

  async function loadJobs(categoryId: number) {
    const { data } = await supabase
      .from("jobs")
      .select("job_id, name, description, category_id")
      .eq("category_id", categoryId)
      .order("name");
    setJobs((data as Job[]) || []);
  }

  async function loadJobsForCategories(categoryIds: number[]) {
    const { data } = await supabase
      .from("jobs")
      .select("job_id, name, description, category_id")
      .in("category_id", categoryIds)
      .order("name");
    setJobs((data as Job[]) || []);
  }

  async function loadAllJobs() {
    const { data } = await supabase
      .from("jobs")
      .select("job_id, name, description, category_id")
      .order("name");
    setAllJobs((data as Job[]) || []);
  }

  function getCategoryPath(categoryId: number) {
    const category = categoryById.get(categoryId);
    if (!category) return "Uncategorized";

    if (!category.parent_category_id) return category.name;

    const parentCategory = categoryById.get(category.parent_category_id);
    return parentCategory ? `${parentCategory.name} / ${category.name}` : category.name;
  }

  function handleCategoryChange(categoryId: number | null) {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId(null);
    setSelectedJobId(null);
    setJobSearch("");
  }

  function handleSubcategoryChange(categoryId: number | null) {
    setSelectedSubcategoryId(categoryId);
    setSelectedJobId(null);
    setJobSearch("");
  }

  function selectJob(job: Job) {
    const category = categoryById.get(job.category_id);
    if (category?.parent_category_id) {
      setSelectedCategoryId(category.parent_category_id);
      setSelectedSubcategoryId(category.category_id);
    } else {
      setSelectedCategoryId(job.category_id);
      setSelectedSubcategoryId(null);
    }

    setJobs((currentJobs) => (
      currentJobs.some((currentJob) => currentJob.job_id === job.job_id)
        ? currentJobs
        : [job, ...currentJobs]
    ));
    setAllJobs((currentJobs) => (
      currentJobs.some((currentJob) => currentJob.job_id === job.job_id)
        ? currentJobs
        : [job, ...currentJobs]
    ));
    setSelectedJobId(job.job_id);
    setJobSearch("");
  }

  async function loadPieceRatePreview(jobId: number, request: { cancelled: boolean }) {
    setIsLoadingPieceRate(true);
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("piece_work_rates")
      .select("rate_id, rate, product_id")
      .eq("job_id", jobId)
      .lte("effective_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("effective_date", { ascending: false });

    if (request.cancelled) return;

    if (error) {
      console.error("Load piecework rate failed", error);
      setPieceRatePreview(null);
      setIsLoadingPieceRate(false);
      return;
    }

    const rates = (data || []) as PieceRatePreview[];
    const chosen =
      rates.find((rate) => rate.product_id === productId) ||
      rates.find((rate) => rate.product_id == null) ||
      null;

    setPieceRatePreview(chosen ? { ...chosen, rate: Number(chosen.rate) } : null);
    setIsLoadingPieceRate(false);
  }

  function resetForm() {
    setSelectedCategoryId(null);
    setSelectedSubcategoryId(null);
    setSelectedJobId(null);
    setJobSearch("");
    setPayType("piece");
    setTimeRequired(1);
    setTimeUnit("minutes");
    setQuantity(1);
  }

  async function add() {
    if (!selectedJobId || isAdding) return;
    setIsAdding(true);
    try {
      const insertData: any = {
        job_id: selectedJobId,
        pay_type: payType,
        time_required: payType === "hourly" ? timeRequired : null,
        time_unit: payType === "hourly" ? timeUnit : "hours",
        quantity,
      };
      const response = await authorizedFetch(`/api/products/${productId}/bol`, {
        method: "POST",
        body: JSON.stringify(insertData),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error || "Failed to add job");
      }
      setOpenState(false);
      resetForm();
      onApplied?.();
    } catch (e) {
      console.error("Add job failed", e);
      const message = e instanceof Error && e.message ? e.message : "Failed to add job";
      alert(message);
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <>
      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isAdding && setOpenState(false)} />
          <div className="relative bg-background border rounded-lg shadow-xl w-[820px] max-h-[80vh] overflow-auto p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Job</h2>
              <Button variant="ghost" size="sm" onClick={() => setOpenState(false)} disabled={isAdding}>Close</Button>
            </div>

            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Job Selection</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <div className="col-span-2 space-y-1.5">
                  <div className="text-xs text-muted-foreground">Search Jobs</div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={jobSearch}
                      onChange={(event) => setJobSearch(event.target.value)}
                      placeholder="Search by job, category, or subcategory..."
                      className="h-10 pl-9"
                    />
                  </div>
                  {jobSearch.trim() && (
                    <div className="max-h-44 overflow-auto rounded-md border border-border/60 bg-background/70">
                      {jobSearchResults.length > 0 ? (
                        jobSearchResults.map((job) => (
                          <button
                            key={job.job_id}
                            type="button"
                            className="flex w-full items-start justify-between gap-3 border-b border-border/50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                            onClick={() => selectJob(job)}
                          >
                            <span className="min-w-0">
                              <span className="block font-medium">{job.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {getCategoryPath(job.category_id)}
                              </span>
                            </span>
                            {selectedJobId === job.job_id && (
                              <span className="text-xs font-medium text-primary">Selected</span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No jobs match that search.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Job Category</div>
                  <Select value={selectedCategoryId?.toString() || ""} onValueChange={(v) => handleCategoryChange(v ? Number(v) : null)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentCategories.map(c => (
                        <SelectItem key={c.category_id} value={String(c.category_id)}>
                          {c.name} - R{c.hourly_rate.toFixed(2)}/hr
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {hasSubcategories && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">Subcategory</div>
                    <Select
                      value={selectedSubcategoryId?.toString() || "all"}
                      onValueChange={(v) => {
                        handleSubcategoryChange(v === "all" ? null : Number(v));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All subcategories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All subcategories</SelectItem>
                        {subcategories.map(c => (
                          <SelectItem key={c.category_id} value={String(c.category_id)}>
                            {c.name} - R{c.hourly_rate.toFixed(2)}/hr
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Job</div>
                  <Select
                    value={selectedJobId?.toString() || ""}
                    onValueChange={(v) => {
                      const jobId = v ? Number(v) : null;
                      setSelectedJobId(jobId);
                      setJobSearch("");
                    }}
                    disabled={!selectedCategoryId}
                  >
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
              </div>
            </section>

            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pay &amp; Time</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Pay Type</div>
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

                {payType === "hourly" ? (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <div className="text-xs text-muted-foreground">Time Required</div>
                      <Input type="number" min="0.01" step="0.01" value={timeRequired} onChange={(e) => setTimeRequired(Math.max(0.01, Number(e.target.value)))} />
                    </div>
                    <div className="w-40 space-y-1.5">
                      <div className="text-xs text-muted-foreground">Unit</div>
                      <Select value={timeUnit} onValueChange={(v: any) => setTimeUnit(v)}>
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
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">Piecework Rate</div>
                    <div className="h-10 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                      {isLoadingPieceRate ? (
                        <span className="text-muted-foreground">Loading rate...</span>
                      ) : pieceRatePreview ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">R{pieceRatePreview.rate.toFixed(2)}/item</span>
                          <span className="text-xs text-muted-foreground">
                            {pieceRatePreview.product_id === productId ? "Product-specific" : "Default rate"}
                          </span>
                        </div>
                      ) : selectedJobId ? (
                        <span className="text-muted-foreground">No active piecework rate set</span>
                      ) : (
                        <span className="text-muted-foreground">Select a job to see the rate</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Quantity</div>
                  <Input type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
                </div>

                {payType === "piece" && pieceRatePreview && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">Line Total</div>
                    <div className="h-10 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm font-medium">
                      R{(pieceRatePreview.rate * quantity).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="flex justify-end border-t border-border/50 pt-4">
              <Button onClick={add} disabled={!selectedJobId || isAdding}>
                {isAdding ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  "Add Job"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <CreateJobModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onJobCreated={(j) => {
          setCreateOpen(false);
          selectJob(j);
        }}
        initialCategoryId={selectedCategoryId || undefined}
      />
    </>
  );
}
