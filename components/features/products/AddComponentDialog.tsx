"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

type ComponentRow = { component_id: number; internal_code: string; description: string | null };
type SupplierRow = {
  supplier_component_id: number;
  component_id: number;
  supplier_id: number;
  price: number;
  supplier?: { supplier_id: number; name: string };
};

export default function AddComponentDialog({
  productId,
  supplierFeatureAvailable = false,
  onApplied,
  open,
  onOpenChange,
  prefill,
  showTriggerButton = true,
}: {
  productId: number;
  supplierFeatureAvailable?: boolean;
  onApplied?: () => void;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  prefill?: { component_id?: number; supplier_component_id?: number };
  showTriggerButton?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const controlled = typeof open === 'boolean';
  const actualOpen = controlled ? (open as boolean) : localOpen;
  const setOpenState = (v: boolean) => (controlled ? onOpenChange?.(v) : setLocalOpen(v));

  // search + selection
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [selected, setSelected] = useState<ComponentRow | null>(null);

  const [quantity, setQuantity] = useState<string>("1");

  // supplier selection (optional)
  const [supplierSearch, setSupplierSearch] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);

  useEffect(() => {
    if (!actualOpen) return;
    void searchComponents();
  }, [actualOpen]);

  // Apply prefill when dialog opens
  useEffect(() => {
    if (!actualOpen || !prefill?.component_id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('components')
          .select('component_id, internal_code, description')
          .eq('component_id', prefill.component_id)
          .maybeSingle();
        if (data) setSelected(data as ComponentRow);
        else setSelected({ component_id: prefill.component_id!, internal_code: String(prefill.component_id), description: null });
        if (supplierFeatureAvailable && prefill.supplier_component_id) {
          setSelectedSupplierId(prefill.supplier_component_id);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [actualOpen, prefill?.component_id, prefill?.supplier_component_id, supplierFeatureAvailable]);

  useEffect(() => {
    if (!selected || !supplierFeatureAvailable) {
      setSuppliers([]);
      setSelectedSupplierId(null);
      return;
    }
    void loadSuppliers(selected.component_id);
  }, [selected, supplierFeatureAvailable]);

  async function searchComponents() {
    setLoading(true);
    try {
      let query = supabase
        .from("components")
        .select("component_id, internal_code, description")
        .order("internal_code")
        .limit(50);

      if (q && q.trim()) {
        query = query.or(`internal_code.ilike.%${q}%,description.ilike.%${q}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setComponents((data as ComponentRow[]) || []);
    } catch (e) {
      console.error("Search components failed", e);
      setComponents([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSuppliers(componentId: number) {
    try {
      const { data, error } = await supabase
        .from("suppliercomponents")
        .select(
          `supplier_component_id, component_id, supplier_id, price, supplier:suppliers(supplier_id, name)`
        )
        .eq("component_id", componentId)
        .order("price");
      if (error) throw error;
      setSuppliers((data as SupplierRow[]) || []);
    } catch (e) {
      console.error("Load suppliers failed", e);
      setSuppliers([]);
    }
  }

  const filteredSuppliers = useMemo(() => {
    if (!supplierSearch) return suppliers;
    const s = supplierSearch.toLowerCase();
    return suppliers.filter((r) => (r.supplier?.name || "").toLowerCase().includes(s));
  }, [suppliers, supplierSearch]);

  async function add() {
    if (!selected) return;
    try {
      setLoading(true);
      const insert: any = {
        product_id: productId,
        component_id: selected.component_id,
        quantity_required: Number(quantity || 0) || 1,
      };
      if (supplierFeatureAvailable && selectedSupplierId) {
        insert.supplier_component_id = selectedSupplierId;
      }
      const { error } = await supabase.from("billofmaterials").insert(insert);
      if (error) throw error;
      setOpenState(false);
      setSelected(null);
      setQuantity("1");
      setSupplierSearch("");
      setSuppliers([]);
      setSelectedSupplierId(null);
      onApplied?.();
    } catch (e) {
      console.error("Add component failed", e);
      alert("Failed to add component");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {showTriggerButton && (
        <Button variant="secondary" onClick={() => setOpenState(true)}>Add Component</Button>
      )}
      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenState(false)} />
          <div className="relative bg-background border rounded-md shadow-xl w-[900px] max-h-[80vh] overflow-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Component</h2>
              <Button variant="ghost" onClick={() => setOpenState(false)}>Close</Button>
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Search components..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-64"
              />
              <Button variant="outline" onClick={() => searchComponents()} disabled={loading}>
                Search
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm">Quantity</span>
                <Input
                  type="number"
                  className="w-28"
                  step="0.01"
                  min="0.0001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <Button onClick={add} disabled={!selected || loading}>Add</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="p-3">Code</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.length === 0 ? (
                      <tr>
                        <td className="p-4 text-muted-foreground" colSpan={3}>
                          {loading ? "Loading…" : "No results"}
                        </td>
                      </tr>
                    ) : (
                      components.map((c) => (
                        <tr key={c.component_id} className={`border-t ${selected?.component_id === c.component_id ? 'bg-accent' : ''}`}>
                          <td className="p-3 font-mono">{c.internal_code}</td>
                          <td className="p-3 text-muted-foreground">{c.description || ''}</td>
                          <td className="p-3">
                            <Button size="sm" variant="outline" onClick={() => setSelected(c)}>
                              Select
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border p-3">
                <div className="font-medium mb-2">Selection</div>
                {!selected ? (
                  <div className="text-sm text-muted-foreground">Select a component to configure supplier and quantity.</div>
                ) : (
                  <>
                    <div className="text-sm mb-2">
                      <span className="font-mono font-medium">{selected.internal_code}</span>
                      <span className="text-muted-foreground ml-2">{selected.description || ''}</span>
                    </div>

                    {supplierFeatureAvailable && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Search suppliers..."
                            value={supplierSearch}
                            onChange={(e) => setSupplierSearch(e.target.value)}
                            className="w-64"
                          />
                        </div>
                        <div className="rounded-md border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left">
                                <th className="p-2">Supplier</th>
                                <th className="p-2">Unit Price</th>
                                <th className="p-2">Select</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredSuppliers.length === 0 ? (
                                <tr><td className="p-3 text-muted-foreground" colSpan={3}>No suppliers</td></tr>
                              ) : (
                                filteredSuppliers.map((s) => (
                                  <tr key={s.supplier_component_id} className={`border-t ${selectedSupplierId === s.supplier_component_id ? 'bg-accent' : ''}`}>
                                    <td className="p-2">{s.supplier?.name || 'Unknown'}</td>
                                    <td className="p-2">R{Number(s.price).toFixed(2)}</td>
                                    <td className="p-2">
                                      <Button size="sm" variant="outline" onClick={() => setSelectedSupplierId(s.supplier_component_id)}>
                                        Select
                                      </Button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
