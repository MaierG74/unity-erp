import { SupplierList } from '@/components/suppliers/supplier-list';

export default function SuppliersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Supplier Management</h1>
        <p className="text-muted-foreground">
          Manage your suppliers, their contact information, and component pricing.
        </p>
      </div>

      <SupplierList />
    </div>
  );
} 