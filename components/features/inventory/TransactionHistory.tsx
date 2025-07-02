'use client'

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { format } from 'date-fns'

type TransactionHistoryProps = {
  componentId?: number
}

type Transaction = {
  transaction_id: number
  quantity: number
  transaction_type: 'IN' | 'OUT'
  transaction_date: string
  order_id: number | null
}

export function TransactionHistory({ componentId }: TransactionHistoryProps) {
  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['transactions', componentId],
    queryFn: async () => {
      if (!componentId) return []
      
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('component_id', componentId)
        .order('transaction_date', { ascending: false })
        .limit(10)
        
      if (error) throw error
      return data
    },
    enabled: !!componentId,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-center text-muted-foreground">
            {componentId 
              ? "No recent transactions"
              : "Select an item to view transactions"}
          </p>
        ) : (
          <div className="space-y-4">
            {transactions.map((transaction) => (
              <div
                key={transaction.transaction_id}
                className="flex items-center justify-between p-2 rounded-lg border"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={
                      transaction.transaction_type === 'IN'
                        ? 'text-green-600 font-medium'
                        : 'text-red-600 font-medium'
                    }>
                      {transaction.transaction_type === 'IN' ? '+' : '-'}
                      {Math.abs(transaction.quantity)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {transaction.order_id && `Order #${transaction.order_id}`}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(transaction.transaction_date), 'PPp')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
} 