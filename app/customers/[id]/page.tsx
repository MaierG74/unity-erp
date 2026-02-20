'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, Trash2, Save, X, Package, DollarSign, TrendingUp, Calendar,
  Plus, Star, Pencil, MoreHorizontal, Phone, Mail, ShoppingCart, FileText,
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/orders';
import type { CustomerContact, CreateCustomerContactData, UpdateCustomerContactData } from '@/types/customers';
import {
  fetchContactsByCustomerId,
  createContact,
  updateContact,
  deleteContact,
  setPrimaryContact,
} from '@/lib/db/customer-contacts';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ---------- Types ----------

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

interface CustomerQuote {
  id: string;
  quote_number: string;
  status: string;
  grand_total: number | null;
  created_at: string;
}

type MetricPeriod = '30D' | '90D' | 'YTD' | '12M';

const PERIODS: { key: MetricPeriod; label: string; description: string }[] = [
  { key: '30D', label: '30D', description: 'Last 30 days' },
  { key: '90D', label: '90D', description: 'Last 90 days' },
  { key: 'YTD', label: 'YTD', description: 'Year to date' },
  { key: '12M', label: '12M', description: 'Last 12 months' },
];

// ---------- Helpers ----------

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'R0.00';
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getPeriodStartDate(period: MetricPeriod): Date {
  const now = new Date();
  switch (period) {
    case '30D': return new Date(now.getTime() - 30 * 86400000);
    case '90D': return new Date(now.getTime() - 90 * 86400000);
    case 'YTD': return new Date(now.getFullYear(), 0, 1);
    case '12M': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
}

function getMonthlyPurchaseData(orders: CustomerOrder[]) {
  const monthlyData: { [key: string]: number } = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    monthlyData[key] = 0;
  }
  orders.forEach(order => {
    const date = new Date(order.order_date);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (key in monthlyData) {
      monthlyData[key] += parseFloat(order.total_amount || '0');
    }
  });
  return Object.entries(monthlyData).map(([month, amount]) => ({ month, amount }));
}

// ---------- Data fetchers ----------

async function fetchCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error('Failed to fetch customer');
  return data;
}

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
  if (error) throw new Error('Failed to fetch customer orders');
  return (data || []).map(order => ({
    ...order,
    status: {
      status_id: order.status?.[0]?.status_id || 0,
      status_name: order.status?.[0]?.status_name || 'Unknown',
    },
  }));
}

async function fetchCustomerQuotes(customerId: string): Promise<CustomerQuote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, quote_number, status, grand_total, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Failed to fetch customer quotes');
  return data || [];
}

// ---------- Sub-components ----------

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

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  onClick?: () => void;
  accent?: boolean;
}

function MetricCard({ title, value, icon, subtitle, onClick, accent }: MetricCardProps) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Card className={onClick ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''}>
      <CardContent className="p-4">
        <Wrapper
          type={onClick ? 'button' : undefined}
          onClick={onClick}
          className="flex items-center justify-between w-full text-left"
        >
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
            accent ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary'
          }`}>
            {icon}
          </div>
        </Wrapper>
      </CardContent>
    </Card>
  );
}

function getStatusBadgeClass(statusName: string): string {
  switch (statusName.toLowerCase()) {
    case 'completed':
    case 'delivered':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'cancelled':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  }
}

function getQuoteStatusBadgeClass(status: string): string {
  switch (status) {
    case 'accepted':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'rejected':
    case 'expired':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  }
}

// ---------- Main Component ----------

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const customerId = params.id as string;

  // Tab state from URL
  const activeTab = searchParams?.get('tab') || 'details';
  const setActiveTab = useCallback((tab: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (tab === 'details') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const query = params.toString();
    router.replace(`/customers/${customerId}${query ? `?${query}` : ''}`, { scroll: false });
  }, [customerId, router, searchParams]);

  // Period selector
  const [period, setPeriod] = useState<MetricPeriod>('12M');

  // Edit state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedCustomer, setEditedCustomer] = useState<Partial<Customer>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Contact dialog state
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CustomerContact | null>(null);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', mobile: '', job_title: '', is_primary: false });
  const [contactSaving, setContactSaving] = useState(false);
  const [deleteContactDialogOpen, setDeleteContactDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<CustomerContact | null>(null);

  // ---------- Data queries ----------

  const {
    data: customer,
    isLoading: isLoadingCustomer,
    error: customerError,
  } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
  });

  const { data: orders = [], isLoading: isLoadingOrders } = useQuery({
    queryKey: ['customerOrders', customerId],
    queryFn: () => fetchCustomerOrders(customerId),
    enabled: !!customerId,
  });

  const { data: quotes = [], isLoading: isLoadingQuotes } = useQuery({
    queryKey: ['customerQuotes', customerId],
    queryFn: () => fetchCustomerQuotes(customerId),
    enabled: !!customerId,
  });

  const { data: contacts = [], isLoading: isLoadingContacts } = useQuery({
    queryKey: ['customerContacts', customerId],
    queryFn: () => fetchContactsByCustomerId(Number(customerId)),
    enabled: !!customerId,
  });

  // ---------- Metrics ----------

  const periodStart = getPeriodStartDate(period);
  const periodOrders = useMemo(
    () => orders.filter((o) => new Date(o.order_date) >= periodStart),
    [orders, periodStart]
  );

  const metrics = useMemo(() => {
    const totalOrders = periodOrders.length;
    const totalSpend = periodOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0);
    const avgOrderValue = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const lastOrderDate = orders.length > 0 ? new Date(orders[0].order_date) : null;
    const outstanding = orders.filter(
      (o) => o.status.status_id !== 30 && o.status.status_id !== 31
    );
    return { totalOrders, totalSpend, avgOrderValue, lastOrderDate, outstanding };
  }, [periodOrders, orders]);

  const monthlyData = useMemo(() => getMonthlyPurchaseData(orders), [orders]);

  // ---------- Contact handlers ----------

  const openAddContact = () => {
    setEditingContact(null);
    setContactForm({ name: '', email: '', phone: '', mobile: '', job_title: '', is_primary: contacts.length === 0 });
    setContactDialogOpen(true);
  };

  const openEditContact = (contact: CustomerContact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      email: contact.email || '',
      phone: contact.phone || '',
      mobile: contact.mobile || '',
      job_title: contact.job_title || '',
      is_primary: contact.is_primary,
    });
    setContactDialogOpen(true);
  };

  const handleSaveContact = async () => {
    setContactSaving(true);
    try {
      if (editingContact) {
        await updateContact(editingContact.id, Number(customerId), {
          name: contactForm.name,
          email: contactForm.email || null,
          phone: contactForm.phone || null,
          mobile: contactForm.mobile || null,
          job_title: contactForm.job_title || null,
          is_primary: contactForm.is_primary,
        });
      } else {
        await createContact({
          customer_id: Number(customerId),
          name: contactForm.name,
          email: contactForm.email || null,
          phone: contactForm.phone || null,
          mobile: contactForm.mobile || null,
          job_title: contactForm.job_title || null,
          is_primary: contactForm.is_primary,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['customerContacts', customerId] });
      setContactDialogOpen(false);
    } catch (err) {
      console.error('Error saving contact:', err);
      alert('Failed to save contact. Please try again.');
    } finally {
      setContactSaving(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!contactToDelete) return;
    try {
      await deleteContact(contactToDelete.id);
      queryClient.invalidateQueries({ queryKey: ['customerContacts', customerId] });
      setDeleteContactDialogOpen(false);
      setContactToDelete(null);
    } catch (err) {
      console.error('Error deleting contact:', err);
      alert('Failed to delete contact.');
    }
  };

  const handleSetPrimary = async (contact: CustomerContact) => {
    try {
      await setPrimaryContact(contact.id, Number(customerId));
      queryClient.invalidateQueries({ queryKey: ['customerContacts', customerId] });
    } catch (err) {
      console.error('Error setting primary contact:', err);
    }
  };

  // ---------- Customer edit handlers ----------

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

  useEffect(() => {
    if (!customer || !isEditing) {
      setHasUnsavedChanges(false);
      return;
    }
    const hasChanges = Object.keys(editedCustomer).some((key) => {
      const originalValue = customer[key as keyof Customer] || '';
      const editedValue = editedCustomer[key as keyof Customer] || '';
      return originalValue !== editedValue;
    });
    setHasUnsavedChanges(hasChanges);
  }, [editedCustomer, customer, isEditing]);

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

  const handleFieldChange = useCallback((field: keyof Customer, value: string) => {
    setEditedCustomer((prev) => ({ ...prev, [field]: value }));
  }, []);

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

  const resetEditState = useCallback(() => {
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

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      setUnsavedDialogOpen(true);
      setPendingNavigation('cancel');
    } else {
      setIsEditing(false);
      resetEditState();
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setUnsavedDialogOpen(true);
      setPendingNavigation('back');
    } else {
      router.back();
    }
  };

  const handleDiscardChanges = () => {
    setHasUnsavedChanges(false);
    setIsEditing(false);
    setUnsavedDialogOpen(false);
    if (pendingNavigation === 'cancel') {
      resetEditState();
    } else if (pendingNavigation === 'back') {
      router.back();
    } else if (pendingNavigation) {
      router.push(pendingNavigation);
    }
    setPendingNavigation(null);
  };

  const handleDeleteCustomer = async () => {
    try {
      const { error } = await supabase.from('customers').delete().eq('id', customerId);
      if (error) throw error;
      router.push('/customers');
    } catch (error) {
      console.error('Error deleting customer:', error);
      alert('Failed to delete customer. Please try again.');
    }
  };

  const handleToggleActive = async () => {
    if (!customer) return;
    const newValue = !(customer as any).is_active;
    try {
      const { error } = await supabase
        .from('customers')
        .update({ is_active: newValue })
        .eq('id', customerId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      console.error('Error toggling active status:', err);
    }
  };

  // ---------- Render ----------

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

  const isActive = (customer as any).is_active !== false;

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
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              isActive
                ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
                : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
              {isActive ? 'Active' : 'Inactive'}
            </span>
            {hasUnsavedChanges && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-2 mr-2">
            <Label htmlFor="active-toggle" className="text-sm text-muted-foreground">Active</Label>
            <Switch
              id="active-toggle"
              checked={isActive}
              onCheckedChange={handleToggleActive}
            />
          </div>
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

      {/* Period selector + Metrics */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Metrics for{' '}
          <span className="font-medium text-foreground">
            {PERIODS.find((p) => p.key === period)?.description}
          </span>
        </p>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                period === p.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:bg-accent text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrders.toString()}
          icon={<Package className="h-5 w-5" />}
          subtitle={`${period} period`}
          onClick={() => setActiveTab('orders')}
        />
        <MetricCard
          title="Total Spend"
          value={formatCurrency(metrics.totalSpend)}
          icon={<DollarSign className="h-5 w-5" />}
          subtitle={`${period} period`}
        />
        <MetricCard
          title="Outstanding"
          value={metrics.outstanding.length.toString()}
          icon={<ShoppingCart className="h-5 w-5" />}
          subtitle="Open orders"
          onClick={() => setActiveTab('orders')}
          accent={metrics.outstanding.length > 0}
        />
        <MetricCard
          title="Last Order"
          value={
            metrics.lastOrderDate
              ? metrics.lastOrderDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'Never'
          }
          icon={<Calendar className="h-5 w-5" />}
          subtitle={
            metrics.lastOrderDate
              ? `${Math.floor((Date.now() - metrics.lastOrderDate.getTime()) / 86400000)} days ago`
              : undefined
          }
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="orders">
            Orders
            {metrics.outstanding.length > 0 && (
              <span className="ml-1.5 bg-primary/20 text-primary rounded-full px-1.5 py-0.5 text-xs font-bold">
                {metrics.outstanding.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* ========== DETAILS TAB ========== */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              {/* Customer Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Customer Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <EditableField label="Name" value={editedCustomer.name || ''} onChange={(v) => handleFieldChange('name', v)} isEditing={isEditing} placeholder="Customer name" />
                    <EditableField label="Contact Person" value={editedCustomer.contact || ''} onChange={(v) => handleFieldChange('contact', v)} isEditing={isEditing} placeholder="Primary contact" />
                    <EditableField label="Email" value={editedCustomer.email || ''} onChange={(v) => handleFieldChange('email', v)} isEditing={isEditing} type="email" placeholder="email@example.com" />
                    <EditableField label="Telephone" value={editedCustomer.telephone || ''} onChange={(v) => handleFieldChange('telephone', v)} isEditing={isEditing} type="tel" placeholder="+27 123 456 7890" />
                  </div>
                </CardContent>
              </Card>

              {/* Address */}
              <Card>
                <CardHeader>
                  <CardTitle>Address</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <EditableField label="Address Line 1" value={editedCustomer.address_line_1 || ''} onChange={(v) => handleFieldChange('address_line_1', v)} isEditing={isEditing} placeholder="Street address" />
                  <EditableField label="Address Line 2" value={editedCustomer.address_line_2 || ''} onChange={(v) => handleFieldChange('address_line_2', v)} isEditing={isEditing} placeholder="Apartment, suite, etc." />
                  <div className="grid grid-cols-2 gap-4">
                    <EditableField label="City" value={editedCustomer.city || ''} onChange={(v) => handleFieldChange('city', v)} isEditing={isEditing} placeholder="City" />
                    <EditableField label="State/Province" value={editedCustomer.state_province || ''} onChange={(v) => handleFieldChange('state_province', v)} isEditing={isEditing} placeholder="State or Province" />
                    <EditableField label="Postal Code" value={editedCustomer.postal_code || ''} onChange={(v) => handleFieldChange('postal_code', v)} isEditing={isEditing} placeholder="Postal code" />
                    <EditableField label="Country" value={editedCustomer.country || ''} onChange={(v) => handleFieldChange('country', v)} isEditing={isEditing} placeholder="Country" />
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <EditableField label="" value={editedCustomer.notes || ''} onChange={(v) => handleFieldChange('notes', v)} isEditing={isEditing} type="textarea" placeholder="Add notes about this customer..." />
                  <div className="mt-4">
                    <EditableField label="Payment Terms" value={editedCustomer.payment_terms || ''} onChange={(v) => handleFieldChange('payment_terms', v)} isEditing={isEditing} placeholder="e.g., Net 30, COD" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column — Contacts */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Contacts</CardTitle>
                  <Button variant="outline" size="sm" onClick={openAddContact}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add Contact
                  </Button>
                </CardHeader>
                <CardContent>
                  {isLoadingContacts ? (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  ) : contacts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No contacts yet. Add your first contact.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {contacts.map((c) => (
                        <div key={c.id} className="flex items-start justify-between p-3 rounded-lg border">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{c.name}</span>
                              {c.is_primary && (
                                <Badge variant="secondary" className="text-xs">
                                  <Star className="mr-1 h-3 w-3" />
                                  Primary
                                </Badge>
                              )}
                              {c.job_title && (
                                <span className="text-xs text-muted-foreground">{c.job_title}</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {c.email && (
                                <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary">
                                  <Mail className="h-3 w-3" />{c.email}
                                </a>
                              )}
                              {c.phone && (
                                <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary">
                                  <Phone className="h-3 w-3" />{c.phone}
                                </a>
                              )}
                              {c.mobile && (
                                <a href={`tel:${c.mobile}`} className="flex items-center gap-1 hover:text-primary">
                                  <Phone className="h-3 w-3" />{c.mobile}
                                </a>
                              )}
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditContact(c)}>
                                <Pencil className="mr-2 h-4 w-4" />Edit
                              </DropdownMenuItem>
                              {!c.is_primary && (
                                <DropdownMenuItem onClick={() => handleSetPrimary(c)}>
                                  <Star className="mr-2 h-4 w-4" />Set as Primary
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => {
                                  setContactToDelete(c);
                                  setDeleteContactDialogOpen(true);
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ========== ORDERS TAB ========== */}
        <TabsContent value="orders">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Orders</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/orders/new?customer=${customerId}`}>
                  <Plus className="mr-1 h-4 w-4" />
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
                <div className="text-sm text-muted-foreground py-8 text-center">
                  No orders found for this customer.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium text-sm">Order #</th>
                        <th className="text-left p-3 font-medium text-sm">Date</th>
                        <th className="text-left p-3 font-medium text-sm">Status</th>
                        <th className="text-right p-3 font-medium text-sm">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.order_id}
                          className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => router.push(`/orders/${order.order_id}`)}
                        >
                          <td className="p-3 font-medium text-primary text-sm">
                            {order.order_number || `#${order.order_id}`}
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">
                            {new Date(order.order_date).toLocaleDateString('en-ZA', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="p-3">
                            <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${getStatusBadgeClass(order.status.status_name)}`}>
                              {order.status.status_name}
                            </span>
                          </td>
                          <td className="p-3 text-right text-sm font-medium">
                            {formatCurrency(parseFloat(order.total_amount || '0'))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== QUOTES TAB ========== */}
        <TabsContent value="quotes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Quotes</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/quotes/new?customer=${customerId}`}>
                  <Plus className="mr-1 h-4 w-4" />
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
                <div className="text-sm text-muted-foreground py-8 text-center">
                  No quotes found for this customer.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium text-sm">Quote #</th>
                        <th className="text-left p-3 font-medium text-sm">Date</th>
                        <th className="text-left p-3 font-medium text-sm">Status</th>
                        <th className="text-right p-3 font-medium text-sm">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((quote) => (
                        <tr
                          key={quote.id}
                          className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => router.push(`/quotes/${quote.id}`)}
                        >
                          <td className="p-3 font-medium text-primary text-sm">
                            {quote.quote_number}
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">
                            {new Date(quote.created_at).toLocaleDateString('en-ZA', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="p-3">
                            <span className={`inline-block px-2 py-0.5 text-xs rounded-full capitalize ${getQuoteStatusBadgeClass(quote.status)}`}>
                              {quote.status}
                            </span>
                          </td>
                          <td className="p-3 text-right text-sm font-medium">
                            {formatCurrency(quote.grand_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== REPORTS TAB ========== */}
        <TabsContent value="reports">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Purchases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
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
                    <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ========== DIALOGS ========== */}

      {/* Delete Customer */}
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

      {/* Unsaved Changes */}
      <AlertDialog open={unsavedDialogOpen} onOpenChange={setUnsavedDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to leave? Your changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingNavigation(null)}>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardChanges} className="bg-red-600 hover:bg-red-700">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add/Edit Contact */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
            <DialogDescription>
              {editingContact
                ? 'Update the contact details below.'
                : 'Add a new contact to this customer\'s address book.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name <span className="text-red-500">*</span></Label>
              <Input
                id="contact-name"
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-job-title">Job Title</Label>
              <Input
                id="contact-job-title"
                value={contactForm.job_title}
                onChange={(e) => setContactForm({ ...contactForm, job_title: e.target.value })}
                placeholder="e.g. Procurement Manager"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact-email">Email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  placeholder="email@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-phone">Phone</Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  placeholder="+27 12 345 6789"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-mobile">Mobile</Label>
              <Input
                id="contact-mobile"
                type="tel"
                value={contactForm.mobile}
                onChange={(e) => setContactForm({ ...contactForm, mobile: e.target.value })}
                placeholder="+27 82 345 6789"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="contact-primary"
                checked={contactForm.is_primary}
                onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                disabled={contacts.length === 0 || (editingContact?.is_primary && contacts.length === 1)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="contact-primary" className="text-sm font-normal">
                Set as primary contact
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)} disabled={contactSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveContact} disabled={contactSaving || !contactForm.name.trim()}>
              {contactSaving ? 'Saving...' : editingContact ? 'Save Changes' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Contact */}
      <AlertDialog open={deleteContactDialogOpen} onOpenChange={setDeleteContactDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {contactToDelete?.name}? This action cannot be undone.
              {contactToDelete?.is_primary && ' The next contact will be promoted to primary.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setContactToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContact} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
