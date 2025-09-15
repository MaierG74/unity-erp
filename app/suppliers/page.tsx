import { SupplierList } from '@/components/features/suppliers/supplier-list';

export default function SuppliersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Supplier Management</h1>
        <p className="text-muted-foreground max-w-3xl">
          Manage your suppliers, their contact information, and component pricing.
        </p>
        <div className="mt-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      <SupplierList />
    </div>
  );
} 