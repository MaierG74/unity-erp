'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { InventoryItem } from '@/types/inventory';

export function LowStockAlerts() {
    const [lowStockItems, setLowStockItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchLowStockItems() {
            try {
                // Fetch inventory items where quantity_on_hand <= reorder_level
                // Note: Supabase filtering on related tables or complex conditions might need RPC or careful query
                // For now, we'll fetch items with reorder_level > 0 and filter in JS if needed, 
                // or use .lte('quantity_on_hand', supabase.raw('reorder_level')) if possible (not directly in JS client usually)
                // Actually, we can just fetch all inventory with reorder_level > 0 and filter.
                // Assuming inventory table is 'inventory' based on types/inventory.ts

                const { data, error } = await supabase
                    .from('inventory')
                    .select(`
            *,
            component:components(internal_code, description, image_url, category:component_categories(categoryname), unit:unitsofmeasure(unit_name))
          `)
                    .gt('reorder_level', 0)
                    .order('quantity_on_hand', { ascending: true })
                    .limit(50); // Fetch enough to filter

                if (error) throw error;

                // Filter for low stock
                const lowStock = (data || []).filter((item: any) => item.quantity_on_hand <= item.reorder_level);

                setLowStockItems(lowStock.slice(0, 5)); // Show top 5
            } catch (error) {
                console.error('Error fetching low stock items:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchLowStockItems();
    }, []);

    if (loading) {
        return (
            <Card className="col-span-3">
                <CardHeader>
                    <CardTitle>Low Stock Alerts</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center space-x-4">
                                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                                <div className="space-y-2 flex-1">
                                    <div className="h-4 w-[200px] bg-muted animate-pulse rounded" />
                                    <div className="h-3 w-[150px] bg-muted animate-pulse rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (lowStockItems.length === 0) {
        return null; // Don't show if no alerts
    }

    return (
        <Card className="col-span-3">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">
                    Low Stock Alerts
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-sm" asChild>
                    <Link href="/inventory">
                        View All <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent>
                <div className="space-y-4 mt-4">
                    {lowStockItems.map((item, index) => (
                        <motion.div
                            key={item.inventory_id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="flex items-center justify-between p-4 border rounded-lg bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/20"
                        >
                            <div className="flex items-center space-x-4">
                                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium leading-none">
                                        {item.component.internal_code} - {item.component.description}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        On Hand: <span className="font-bold text-red-600 dark:text-red-400">{item.quantity_on_hand}</span> / Reorder: {item.reorder_level} {item.component.unit?.unit_name}
                                    </p>
                                </div>
                            </div>
                            <Button variant="outline" size="sm" className="h-8 border-red-200 hover:bg-red-100 hover:text-red-900 dark:border-red-800 dark:hover:bg-red-900/50" asChild>
                                <Link href={`/inventory?search=${item.component.internal_code}`}>
                                    Order
                                </Link>
                            </Button>
                        </motion.div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
