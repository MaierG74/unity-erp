"use client";

import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fetchSuppliersSimple, fetchSupplierComponentsBySupplier, type SupplierLite, type SupplierComponentWithMaster } from '@/lib/db/quotes';
import { Search } from 'lucide-react';

interface SupplierBrowseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (sc: SupplierComponentWithMaster) => void;
}

export default function SupplierBrowseModal({ open, onOpenChange, onSelect }: SupplierBrowseModalProps) {
  const [suppliers, setSuppliers] = React.useState<SupplierLite[]>([]);
  const [supplierQuery, setSupplierQuery] = React.useState('');
  const [selectedSupplierId, setSelectedSupplierId] = React.useState<number | null>(null);
  const [components, setComponents] = React.useState<SupplierComponentWithMaster[]>([]);
  const [compQuery, setCompQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      const list = await fetchSuppliersSimple();
      setSuppliers(list);
    })();
  }, [open]);

  React.useEffect(() => {
    if (!open || !selectedSupplierId) return;
    setLoading(true);
    fetchSupplierComponentsBySupplier(selectedSupplierId)
      .then(setComponents)
      .finally(() => setLoading(false));
  }, [open, selectedSupplierId]);

  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase()));
  const filteredComponents = components.filter(it => {
    const q = compQuery.toLowerCase();
    if (!q) return true;
    const fields = [
      it.component?.internal_code || '',
      it.component?.description || '',
      it.supplier_code || '',
    ].map(v => v.toLowerCase());
    return fields.some(f => f.includes(q));
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-auto right-0 top-0 translate-x-0 translate-y-0 h-screen max-w-[90vw] w-[1200px] sm:rounded-none p-0 overflow-hidden border-l shadow-2xl">
        <div className="flex h-full">
          {/* Suppliers list */}
          <div className="w-64 shrink-0 border-r bg-card flex flex-col">
            <div className="p-4 border-b">
              <div className="text-sm font-medium mb-2">Suppliers</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={supplierQuery}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                  placeholder="Search suppliers"
                  className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {filteredSuppliers.map(s => (
                <button
                  key={s.supplier_id}
                  onClick={() => { setSelectedSupplierId(s.supplier_id); setCompQuery(''); }}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-accent hover:text-accent-foreground text-sm ${selectedSupplierId === s.supplier_id ? 'bg-accent/50' : ''}`}
                >
                  {s.name}
                </button>
              ))}
              {filteredSuppliers.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No suppliers</div>
              )}
            </div>
          </div>

          {/* Components for selected supplier */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="p-4 border-b flex items-center gap-4">
              <div className="text-sm font-medium">{selectedSupplierId ? 'Components' : 'Select a supplier'}</div>
              {selectedSupplierId && (
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={compQuery}
                    onChange={(e) => setCompQuery(e.target.value)}
                    placeholder="Filter components"
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {selectedSupplierId ? (
                loading ? (
                  <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : (
                  <div className="min-w-full">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background border-b">
                        <tr className="text-muted-foreground">
                          <th className="text-left p-3 w-32 font-medium">Code</th>
                          <th className="text-left p-3 font-medium">Description</th>
                          <th className="text-left p-3 w-36 font-medium">Supplier Code</th>
                          <th className="text-right p-3 w-24 font-medium">Price</th>
                          <th className="text-right p-3 w-32 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const min = filteredComponents.reduce((m, r) => (Number(r.price || Infinity) < m ? Number(r.price || Infinity) : m), Infinity);
                          return filteredComponents.map((it) => {
                            const isLowest = Number(it.price || Infinity) === min && Number.isFinite(min);
                            return (
                              <tr key={it.supplier_component_id} className="border-b hover:bg-muted/40">
                                <td className="p-3 font-medium">{it.component?.internal_code}</td>
                                <td className="p-3 max-w-0 truncate">{it.component?.description || '-'}</td>
                                <td className="p-3 truncate">{it.supplier_code || '-'}</td>
                                <td className="p-3 text-right">R{Number(it.price || 0).toFixed(2)} {isLowest && (<span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 align-middle">Lowest</span>)}</td>
                                <td className="p-3 text-right">
                                  <Button size="sm" className="min-w-[80px]" onClick={() => { onSelect(it); onOpenChange(false); }}>
                                    Select
                                  </Button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                        {filteredComponents.length === 0 && (
                          <tr>
                            <td className="p-6 text-center text-muted-foreground" colSpan={5}>No components</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="p-6 text-center text-muted-foreground">Choose a supplier on the left to browse their components.</div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
