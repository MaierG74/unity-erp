'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, FileText, Package, Users, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

interface Stats {
    totalOrders: number;
    totalOpenOrders: number;
    totalProducts: number;
    totalCustomers: number;
}

export function DashboardStats() {
    const [stats, setStats] = useState<Stats>({
        totalOrders: 0,
        totalOpenOrders: 0,
        totalProducts: 0,
        totalCustomers: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            try {
                // Fetch Total Orders
                const { count: ordersCount, error: ordersError } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true });

                if (ordersError) throw ordersError;

                // Fetch Open Orders
                // We fetch all orders with their status to filter in JS since we don't have the status IDs hardcoded
                const { data: openOrdersData, error: openOrdersError } = await supabase
                    .from('orders')
                    .select('status:order_statuses(status_name)');

                if (openOrdersError) throw openOrdersError;

                const openOrdersCount = openOrdersData?.filter((order: any) => {
                    const status = order.status?.status_name?.toLowerCase();
                    return status !== 'completed' && status !== 'cancelled';
                }).length || 0;

                // Fetch Products Count
                const { count: productsCount, error: productsError } = await supabase
                    .from('products')
                    .select('*', { count: 'exact', head: true });

                if (productsError) throw productsError;

                // Fetch Customers Count
                const { count: customersCount, error: customersError } = await supabase
                    .from('customers')
                    .select('*', { count: 'exact', head: true });

                if (customersError) throw customersError;

                setStats({
                    totalOrders: ordersCount || 0,
                    totalOpenOrders: openOrdersCount,
                    totalProducts: productsCount || 0,
                    totalCustomers: customersCount || 0,
                });
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchStats();
    }, []);

    const statItems = [
        {
            title: 'Total Orders',
            value: stats.totalOrders.toLocaleString(),
            icon: ShoppingCart,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
        },
        {
            title: 'Total Open Orders',
            value: stats.totalOpenOrders.toLocaleString(),
            icon: FileText,
            color: 'text-green-500',
            bgColor: 'bg-green-500/10',
        },
        {
            title: 'Active Products',
            value: stats.totalProducts.toLocaleString(),
            icon: Package,
            color: 'text-purple-500',
            bgColor: 'bg-purple-500/10',
        },
        {
            title: 'Total Customers',
            value: stats.totalCustomers.toLocaleString(),
            icon: Users,
            color: 'text-orange-500',
            bgColor: 'bg-orange-500/10',
        },
    ];

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <div className="h-4 w-24 bg-muted rounded"></div>
                            <div className="h-4 w-4 bg-muted rounded"></div>
                        </CardHeader>
                        <CardContent>
                            <div className="h-8 w-16 bg-muted rounded"></div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {statItems.map((item, index) => (
                <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                >
                    <Card className="overflow-hidden border-none shadow-md hover:shadow-lg transition-shadow duration-300">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {item.title}
                            </CardTitle>
                            <div className={`p-2 rounded-full ${item.bgColor}`}>
                                <item.icon className={`h-4 w-4 ${item.color}`} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{item.value}</div>
                            <p className="text-xs text-muted-foreground mt-1 flex items-center">
                                <TrendingUp className="h-3 w-3 mr-1 text-green-500" />
                                <span className="text-green-500 font-medium">+2.5%</span>
                                <span className="ml-1">from last month</span>
                            </p>
                        </CardContent>
                    </Card>
                </motion.div>
            ))}
        </div>
    );
}
