'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Trash2, Save, X, Package, DollarSign, TrendingUp, Calendar } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import { useState, useEffect, useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Function to fetch a single customer by ID
async function fetchCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching customer:', error);
    throw new Error('Failed to fetch customer');
  }

  return data;
}

// Define the order type with status
interface CustomerOrder {
  order_id: number;
  order_number: string | null;
  order_date: string;
  total_amount: string | null;
  status: {
    status_id: number;
    status_name: string;
  };
}

// Function to fetch orders for a customer
async function fetchCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      order_id,
      order_number,
      order_date,
      total_amount,
      status:order_statuses(status_id, status_name)
    `)
    .eq('customer_id', customerId)
    .order('order_date', { ascending: false });

  if (error) {
    console.error('Error fetching customer orders:', error);
    throw new Error('Failed to fetch customer orders');
  }

  // Transform the data to match the CustomerOrder interface
  const transformedData = (data || []).map(order => ({
    ...order,
    status: {
      status_id: order.status?.[0]?.status_id || 0,
      status_name: order.status?.[0]?.status_name || 'Unknown'
    }
  }));

  return transformedData;
}

// Define quote type
interface CustomerQuote {
  id: string;
  quote_number: string;
  status: string;
  grand_total: number | null;
  created_at: string;
}

// Function to fetch quotes for a customer
async function fetchCustomerQuotes(customerId: string): Promise<CustomerQuote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, quote_number, status, grand_total, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching customer quotes:', error);
    throw new Error('Failed to fetch customer quotes');
  }

  return data || [];
}

// Format currency
function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'R0.00';
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Get monthly purchase data for chart
function getMonthlyPurchaseData(orders: CustomerOrder[]) {
  const monthlyData: { [key: string]: number } = {};
  const now = new Date();

  // Initialize last 12 months with 0
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    monthlyData[key] = 0;
  }

  // Sum up orders by month
  orders.forEach(order => {
    const date = new Date(order.order_date);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (key in monthlyData) {
      monthlyData[key] += parseFloat(order.total_amount || '0');
    }
  });

  return Object.entries(monthlyData).map(([month, amount]) => ({
    month,
    amount,
  }));
}

// Calculate metrics
function calculateMetrics(orders: CustomerOrder[]) {
  const totalOrders = orders.length;
  const lifetimeValue = orders.reduce((sum, order) => sum + parseFloat(order.total_amount || '0'), 0);
  const avgOrderValue = totalOrders > 0 ? lifetimeValue / totalOrders : 0;
  const lastOrderDate = orders.length > 0 ? new Date(orders[0].order_date) : null;

  return { totalOrders, lifetimeValue, avgOrderValue, lastOrderDate };
}

// Editable field component
interface EditableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  type?: 'text' | 'email' | 'tel' | 'textarea';
  placeholder?: string;
}

function EditableField({ label, value, onChange, isEditing, type = 'text', placeholder }: EditableFieldProps) {
  if (type === 'textarea') {
    return (
      <div className="space-y-1">
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {isEditing ? (
          <Textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-[100px]"
          />
        ) : (
          <p className="text-sm font-medium whitespace-pre-wrap">{value || 'N/A'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {isEditing ? (
        <Input
          type={type}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <p className="text-sm font-medium">
          {type === 'email' && value ? (
            <a href={`mailto:${value}`} className="text-primary hover:underline">{value}</a>
          ) : type === 'tel' && value ? (
            <a href={`tel:${value}`} className="text-primary hover:underline">{value}</a>
          ) : (
            value || 'N/A'
          )}
        </p>
      )}
    </div>
  );
}

// Metric card component
interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}

function MetricCard({ title, value, icon, subtitle }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customerId = params.id as string;

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedCustomer, setEditedCustomer] = useState<Partial<Customer>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Fetch customer details
  const {
    data: customer,
    isLoading: isLoadingCustomer,
    error: customerError
  } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
  });

  // Fetch customer orders
  const {
    data: orders = [],
    isLoading: isLoadingOrders,
  } = useQuery({
    queryKey: ['customerOrders', customerId],
    queryFn: () => fetchCustomerOrders(customerId),
    enabled: !!customerId,
  });

  // Fetch customer quotes
  const {
    data: quotes = [],
    isLoading: isLoadingQuotes,
  } = useQuery({
    queryKey: ['customerQuotes', customerId],
    queryFn: () => fetchCustomerQuotes(customerId),
    enabled: !!customerId,
  });

  // Initialize edited customer when data loads
  useEffect(() => {
    if (customer) {
      setEditedCustomer({
        name: customer.name || '',
        contact: customer.contact || '',
        email: customer.email || '',
        telephone: customer.telephone || '',
        address_line_1: customer.address_line_1 || '',
        address_line_2: customer.address_line_2 || '',
        city: customer.city || '',
        state_province: customer.state_province || '',
        postal_code: customer.postal_code || '',
        country: customer.country || '',
        notes: customer.notes || '',
        payment_terms: customer.payment_terms || '',
      });
    }
  }, [customer]);

  // Track unsaved changes
  useEffect(() => {
    if (!customer || !isEditing) {
      setHasUnsavedChanges(false);
      return;
    }

    const hasChanges = Object.keys(editedCustomer).some(key => {
      const originalValue = customer[key as keyof Customer] || '';
      const editedValue = editedCustomer[key as keyof Customer] || '';
      return originalValue !== editedValue;
    });

    setHasUnsavedChanges(hasChanges);
  }, [editedCustomer, customer, isEditing]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Handle field changes
  const handleFieldChange = useCallback((field: keyof Customer, value: string) => {
    setEditedCustomer(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);

    try {
      const { error } = await supabase
        .from('customers')
        .update({
          name: editedCustomer.name || null,
          contact: editedCustomer.contact || null,
          email: editedCustomer.email || null,
          telephone: editedCustomer.telephone || null,
          address_line_1: editedCustomer.address_line_1 || null,
          address_line_2: editedCustomer.address_line_2 || null,
          city: editedCustomer.city || null,
          state_province: editedCustomer.state_province || null,
          postal_code: editedCustomer.postal_code || null,
          country: editedCustomer.country || null,
          notes: editedCustomer.notes || null,
          payment_terms: editedCustomer.payment_terms || null,
        })
        .eq('id', customerId);

      if (error) throw error;

      // Invalidate and refetch customer data
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });

      setIsEditing(false);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Error saving customer:', error);
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setUnsavedDialogOpen(true);
      setPendingNavigation('cancel');
    } else {
      setIsEditing(false);
      if (customer) {
        setEditedCustomer({
          name: customer.name || '',
          contact: customer.contact || '',
          email: customer.email || '',
          telephone: customer.telephone || '',
          address_line_1: customer.address_line_1 || '',
          address_line_2: customer.address_line_2 || '',
          city: customer.city || '',
          state_province: customer.state_province || '',
          postal_code: customer.postal_code || '',
          country: customer.country || '',
          notes: customer.notes || '',
          payment_terms: customer.payment_terms || '',
        });
      }
    }
  };

  // Handle back navigation - use router.back() to preserve URL filters
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setUnsavedDialogOpen(true);
      setPendingNavigation('back');
    } else {
      router.back();
    }
  };

  // Handle discard changes
  const handleDiscardChanges = () => {
    setHasUnsavedChanges(false);
    setIsEditing(false);
    setUnsavedDialogOpen(false);

    if (pendingNavigation === 'cancel') {
      if (customer) {
        setEditedCustomer({
          name: customer.name || '',
          contact: customer.contact || '',
          email: customer.email || '',
          telephone: customer.telephone || '',
          address_line_1: customer.address_line_1 || '',
          address_line_2: customer.address_line_2 || '',
          city: customer.city || '',
          state_province: customer.state_province || '',
          postal_code: customer.postal_code || '',
          country: customer.country || '',
          notes: customer.notes || '',
          payment_terms: customer.payment_terms || '',
        });
      }
    } else if (pendingNavigation === 'back') {
      // Use router.back() to preserve URL filters when navigating back
      router.back();
    } else if (pendingNavigation) {
      router.push(pendingNavigation);
    }

    setPendingNavigation(null);
  };

  // Handle customer deletion
  const handleDeleteCustomer = async () => {
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (error) throw error;

      router.push('/customers');
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert('Failed to delete customer. Please try again.');
    }
  };

  // Calculate metrics and chart data
  const metrics = calculateMetrics(orders);
  const monthlyData = getMonthlyPurchaseData(orders);

  if (isLoadingCustomer) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (customerError || !customer) {
    return (
      <div className="bg-red-50 text-red-500 p-4 rounded-md">
        Customer not found or error loading customer details.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{customer.name || 'Unnamed Customer'}</h1>
            {hasUnsavedChanges && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="flex space-x-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrders.toString()}
          icon={<Package className="h-5 w-5" />}
        />
        <MetricCard
          title="Lifetime Value"
          value={formatCurrency(metrics.lifetimeValue)}
          icon={<DollarSign className="h-5 w-5" />}
        />
        <MetricCard
          title="Avg Order Value"
          value={formatCurrency(metrics.avgOrderValue)}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <MetricCard
          title="Last Order"
          value={metrics.lastOrderDate
            ? metrics.lastOrderDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Never'}
          icon={<Calendar className="h-5 w-5" />}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Customer Information */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <EditableField
                  label="Name"
                  value={editedCustomer.name || ''}
                  onChange={(v) => handleFieldChange('name', v)}
                  isEditing={isEditing}
                  placeholder="Customer name"
                />
                <EditableField
                  label="Contact Person"
                  value={editedCustomer.contact || ''}
                  onChange={(v) => handleFieldChange('contact', v)}
                  isEditing={isEditing}
                  placeholder="Primary contact"
                />
                <EditableField
                  label="Email"
                  value={editedCustomer.email || ''}
                  onChange={(v) => handleFieldChange('email', v)}
                  isEditing={isEditing}
                  type="email"
                  placeholder="email@example.com"
                />
                <EditableField
                  label="Telephone"
                  value={editedCustomer.telephone || ''}
                  onChange={(v) => handleFieldChange('telephone', v)}
                  isEditing={isEditing}
                  type="tel"
                  placeholder="+27 123 456 7890"
                />
              </div>
            </CardContent>
          </Card>

          {/* Address */}
          <Card>
            <CardHeader>
              <CardTitle>Address</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <EditableField
                label="Address Line 1"
                value={editedCustomer.address_line_1 || ''}
                onChange={(v) => handleFieldChange('address_line_1', v)}
                isEditing={isEditing}
                placeholder="Street address"
              />
              <EditableField
                label="Address Line 2"
                value={editedCustomer.address_line_2 || ''}
                onChange={(v) => handleFieldChange('address_line_2', v)}
                isEditing={isEditing}
                placeholder="Apartment, suite, etc."
              />
              <div className="grid grid-cols-2 gap-4">
                <EditableField
                  label="City"
                  value={editedCustomer.city || ''}
                  onChange={(v) => handleFieldChange('city', v)}
                  isEditing={isEditing}
                  placeholder="City"
                />
                <EditableField
                  label="State/Province"
                  value={editedCustomer.state_province || ''}
                  onChange={(v) => handleFieldChange('state_province', v)}
                  isEditing={isEditing}
                  placeholder="State or Province"
                />
                <EditableField
                  label="Postal Code"
                  value={editedCustomer.postal_code || ''}
                  onChange={(v) => handleFieldChange('postal_code', v)}
                  isEditing={isEditing}
                  placeholder="Postal code"
                />
                <EditableField
                  label="Country"
                  value={editedCustomer.country || ''}
                  onChange={(v) => handleFieldChange('country', v)}
                  isEditing={isEditing}
                  placeholder="Country"
                />
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableField
                label=""
                value={editedCustomer.notes || ''}
                onChange={(v) => handleFieldChange('notes', v)}
                isEditing={isEditing}
                type="textarea"
                placeholder="Add notes about this customer..."
              />
              <div className="mt-4">
                <EditableField
                  label="Payment Terms"
                  value={editedCustomer.payment_terms || ''}
                  onChange={(v) => handleFieldChange('payment_terms', v)}
                  isEditing={isEditing}
                  placeholder="e.g., Net 30, COD"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Monthly Purchases Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Purchases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `R${(value / 1000).toFixed(0)}k`}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Amount']}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar
                      dataKey="amount"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Orders</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/orders/new?customer=${customerId}`}>
                  Create Order
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingOrders ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No orders found for this customer.
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 5).map((order) => (
                    <Link
                      key={order.order_id}
                      href={`/orders/${order.order_id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {order.order_number || `#${order.order_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(order.order_date).toLocaleDateString('en-ZA')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">
                          {formatCurrency(parseFloat(order.total_amount || '0'))}
                        </p>
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          order.status?.status_name === 'Completed'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : order.status?.status_name === 'Cancelled'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {order.status?.status_name || 'Unknown'}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {orders.length > 5 && (
                    <div className="pt-2 text-center">
                      <Link
                        href={`/orders?customer=${customerId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View all {orders.length} orders
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Quotes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Quotes</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/quotes/new?customer=${customerId}`}>
                  Create Quote
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingQuotes ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : quotes.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No quotes found for this customer.
                </div>
              ) : (
                <div className="space-y-2">
                  {quotes.slice(0, 5).map((quote) => (
                    <Link
                      key={quote.id}
                      href={`/quotes/${quote.id}`}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-sm">{quote.quote_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(quote.created_at).toLocaleDateString('en-ZA')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">
                          {formatCurrency(quote.grand_total)}
                        </p>
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full capitalize ${
                          quote.status === 'accepted'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : quote.status === 'rejected'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>
                          {quote.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {quotes.length > 5 && (
                    <div className="pt-2 text-center">
                      <Link
                        href={`/quotes?customer=${customerId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View all {quotes.length} quotes
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the customer and cannot be undone.
              Any orders associated with this customer will remain but will no longer be linked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={unsavedDialogOpen} onOpenChange={setUnsavedDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to leave? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingNavigation(null)}>
              Keep Editing
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardChanges} className="bg-red-600 hover:bg-red-700">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
