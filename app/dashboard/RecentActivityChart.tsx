'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import { motion } from 'framer-motion';

interface DailyRevenue {
    date: string;
    revenue: number;
}

export function RecentActivityChart() {
    const [data, setData] = useState<DailyRevenue[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const thirtyDaysAgo = subDays(new Date(), 30);
                const { data: orders, error } = await supabase
                    .from('orders')
                    .select('created_at, total_amount')
                    .gte('created_at', thirtyDaysAgo.toISOString())
                    .order('created_at', { ascending: true });

                if (error) throw error;

                // Group by date
                const groupedData: Record<string, number> = {};

                // Initialize last 30 days with 0
                for (let i = 0; i < 30; i++) {
                    const date = subDays(new Date(), i);
                    const dateStr = format(date, 'MMM dd');
                    groupedData[dateStr] = 0;
                }

                orders?.forEach(order => {
                    const dateStr = format(parseISO(order.created_at), 'MMM dd');
                    if (groupedData[dateStr] !== undefined) {
                        groupedData[dateStr] += Number(order.total_amount) || 0;
                    }
                });

                const chartData = Object.entries(groupedData)
                    .map(([date, revenue]) => ({ date, revenue }))
                    .sort((a, b) => {
                        // Custom sort to ensure chronological order if needed, 
                        // but initializing the map in reverse order and then reversing the array might be easier.
                        // For now, let's rely on the fact that we want to show the trend.
                        // Actually, the map iteration order isn't guaranteed for string keys in all JS engines (though mostly is now).
                        // Let's rebuild it properly.
                        return 0;
                    });

                // Re-build properly sorted
                const sortedData: DailyRevenue[] = [];
                for (let i = 29; i >= 0; i--) {
                    const date = subDays(new Date(), i);
                    const dateStr = format(date, 'MMM dd');
                    sortedData.push({
                        date: dateStr,
                        revenue: groupedData[dateStr] || 0
                    });
                }

                setData(sortedData);
            } catch (error) {
                console.error('Error fetching chart data:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, []);

    if (loading) {
        return (
            <Card className="col-span-4 animate-pulse">
                <CardHeader>
                    <div className="h-6 w-32 bg-muted rounded"></div>
                </CardHeader>
                <CardContent>
                    <div className="h-[350px] bg-muted rounded"></div>
                </CardContent>
            </Card>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="col-span-4"
        >
            <Card className="col-span-4 shadow-md border-none">
                <CardHeader>
                    <CardTitle>Revenue Overview</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="date"
                                    stroke="#888888"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    tickFormatter={(value) => `R${value}`}
                                    stroke="#888888"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="rounded-lg border bg-background p-2 shadow-sm">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                                Date
                                                            </span>
                                                            <span className="font-bold text-muted-foreground">
                                                                {payload[0].payload.date}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                                Revenue
                                                            </span>
                                                            <span className="font-bold">
                                                                R{payload[0].value}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#8884d8"
                                    fillOpacity={1}
                                    fill="url(#colorRevenue)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
