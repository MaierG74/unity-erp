/**
 * Suppliers Page
 *
 * REFACTORED: Removed extra wrapper classes.
 * SupplierList now uses PageToolbar internally.
 */
import { SupplierList } from '@/components/features/suppliers/supplier-list';

export default function SuppliersPage() {
  return (
    // CHANGED: Removed card bg-card shadow-lg classes, reduced space-y from 8 to 2
    <div className="space-y-2">
      <SupplierList />
    </div>
  );
}
