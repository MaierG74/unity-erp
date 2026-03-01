'use client';

import React from 'react';
import { Package, Layers, Wrench, Cog, PaintBucket } from 'lucide-react';

/** Simple colour-coded status pill for order statuses. */
export function StatusBadge({ status }: { status: string }) {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'new':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'in progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
      {status}
    </span>
  );
}

/** Determine which manufacturing sections a product belongs to based on name/description keywords. */
export function determineProductSections(product: any): string[] {
  const sections: string[] = [];

  if (product?.name?.toLowerCase().includes('chair') ||
      product?.description?.toLowerCase().includes('upholstery')) {
    sections.push('chair');
  }
  if (product?.description?.toLowerCase().includes('wood')) {
    sections.push('wood');
  }
  if (product?.description?.toLowerCase().includes('steel')) {
    sections.push('steel');
  }
  if (product?.description?.toLowerCase().includes('mechanical')) {
    sections.push('mechanical');
  }
  if (product?.description?.toLowerCase().includes('powder') ||
      product?.description?.toLowerCase().includes('coating')) {
    sections.push('powdercoating');
  }

  return sections;
}

export interface OrderSection {
  name: string;
  icon: React.ReactNode;
  color: string;
}

/** Map of manufacturing section keys → display metadata. */
export const ORDER_SECTIONS: { [key: string]: OrderSection } = {
  chair: {
    name: 'Chair',
    icon: <Package className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  wood: {
    name: 'Wood',
    icon: <Layers className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  steel: {
    name: 'Steel',
    icon: <Wrench className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  mechanical: {
    name: 'Mechanical',
    icon: <Cog className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
  powdercoating: {
    name: 'Powdercoating',
    icon: <PaintBucket className="h-4 w-4" />,
    color: 'bg-gray-100 text-gray-800',
  },
};

export interface SupplierOrder {
  supplier_id: number;
  order_date: string;
  status: string;
  notes?: string;
  components: Array<{
    supplier_component_id: number;
    order_quantity: number;
    unit_price: number;
  }>;
}
