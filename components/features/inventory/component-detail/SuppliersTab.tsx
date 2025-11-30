'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, DollarSign, Package, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AddSupplierDialog } from './AddSupplierDialog';
import { EditSupplierDialog } from './EditSupplierDialog';
import { DeleteSupplierDialog } from './DeleteSupplierDialog';

type ComponentData = {
  component_id: number;
  supplierComponents: Array<{
    supplier_component_id: number;
    supplier_id: number;
    supplier_code: string;
    price: number;
    supplier: {
      supplier_id: number;
      name: string;
    };
  }>;
};

type SuppliersTabProps = {
  component: ComponentData;
};

export function SuppliersTab({ component }: SuppliersTabProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<ComponentData['supplierComponents'][0] | null>(null);
  
  const suppliers = component.supplierComponents;

  const handleEdit = (supplier: ComponentData['supplierComponents'][0]) => {
    setSelectedSupplier(supplier);
    setEditDialogOpen(true);
  };

  const handleDelete = (supplier: ComponentData['supplierComponents'][0]) => {
    setSelectedSupplier(supplier);
    setDeleteDialogOpen(true);
  };

  if (suppliers.length === 0) {
    return (
      <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Suppliers
            </CardTitle>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Supplier
            </Button>
          </CardHeader>
          <CardContent>
            <div className="text-center text-muted-foreground py-8">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No suppliers linked to this component.</p>
              <p className="text-sm mt-2">
                Add suppliers to track pricing and availability.
              </p>
            </div>
          </CardContent>
        </Card>

        <AddSupplierDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          componentId={component.component_id}
        />
      </>
    );
  }

  // Calculate price statistics
  const prices = suppliers.map((s) => Number(s.price));
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div className="space-y-6">
      {/* Price Summary with Add Button in first card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Price</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(avgPrice)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lowest Price</CardTitle>
            <Package className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(minPrice)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Highest Price</CardTitle>
            <Package className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(maxPrice)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Suppliers Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Supplier List ({suppliers.length})
          </CardTitle>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier Name</TableHead>
                <TableHead>Supplier Code</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Price Rank</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers
                .sort((a, b) => Number(a.price) - Number(b.price))
                .map((supplier, index) => (
                  <TableRow key={supplier.supplier_component_id}>
                    <TableCell className="font-medium">
                      {supplier.supplier.name}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {supplier.supplier_code}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {new Intl.NumberFormat('en-ZA', {
                        style: 'currency',
                        currency: 'ZAR',
                      }).format(Number(supplier.price))}
                    </TableCell>
                    <TableCell className="text-right">
                      {index === 0 ? (
                        <Badge className="bg-green-100 text-green-800 border-green-300">
                          Lowest
                        </Badge>
                      ) : index === suppliers.length - 1 ? (
                        <Badge variant="outline">Highest</Badge>
                      ) : (
                        <span className="text-muted-foreground">#{index + 1}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEdit(supplier)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(supplier)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Supplier Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {suppliers.map((supplier) => (
          <Card key={supplier.supplier_component_id}>
            <CardHeader>
              <CardTitle className="text-base">{supplier.supplier.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Supplier Code:</span>
                <span className="font-mono text-sm font-medium">
                  {supplier.supplier_code}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Unit Price:</span>
                <span className="font-semibold">
                  {new Intl.NumberFormat('en-ZA', {
                    style: 'currency',
                    currency: 'ZAR',
                  }).format(Number(supplier.price))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Price vs Average:</span>
                <span
                  className={
                    Number(supplier.price) < avgPrice
                      ? 'text-green-600 font-medium'
                      : Number(supplier.price) > avgPrice
                      ? 'text-red-600 font-medium'
                      : 'text-muted-foreground'
                  }
                >
                  {Number(supplier.price) < avgPrice
                    ? `-${((avgPrice - Number(supplier.price)) / avgPrice * 100).toFixed(1)}%`
                    : Number(supplier.price) > avgPrice
                    ? `+${((Number(supplier.price) - avgPrice) / avgPrice * 100).toFixed(1)}%`
                    : 'Average'}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialogs */}
      <AddSupplierDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        componentId={component.component_id}
      />

      {selectedSupplier && (
        <>
          <EditSupplierDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            supplierComponent={selectedSupplier}
          />
          <DeleteSupplierDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            supplierComponent={selectedSupplier}
          />
        </>
      )}
    </div>
  );
}

