'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Eye, Pencil, Trash2, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState as useReactState } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/quotes';

interface Quote {
  id: string;
  quote_number: string;
  customer_id: string;
  status: string;
  created_at: string;
  grand_total: number;
  customer?: { id: string; name?: string | null };
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'>('all');
  const [sort, setSort] = useState<'created_desc' | 'created_asc' | 'total_desc' | 'total_asc'>('created_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();
  const routerNav = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [tableFlash, setTableFlash] = useReactState(false);

  useEffect(() => {
    const fetchQuotes = async () => {
      try {
        setError(null);
        const res = await fetch('/api/quotes', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = await res.json();
        const list: Quote[] = (json?.quotes || []).map((q: any) => ({
          id: q.id,
          quote_number: q.quote_number,
          customer_id: String(q.customer_id ?? ''),
          status: q.status ?? 'draft',
          created_at: q.created_at,
          grand_total: Number(q.grand_total ?? 0),
          customer: q.customer || undefined,
        }));
        setQuotes(list);
      } catch (err: any) {
        console.error('Failed to fetch quotes:', err);
        setError('Could not load quotes.');
      } finally {
        setLoading(false);
      }
    };

    fetchQuotes();
  }, []);

  // Initialize state from query params
  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString());
    const s = p.get('q') || '';
    const st = (p.get('status') || 'all') as any;
    const sortQ = (p.get('sort') || 'created_desc') as any;
    const pg = parseInt(p.get('page') || '1', 10);
    const ps = parseInt(p.get('pageSize') || '10', 10);
    setSearch(s);
    setSearchInput(s);
    setStatus(['all','draft','sent','accepted','rejected','expired'].includes(st) ? st : 'all');
    setSort(['created_desc','created_asc','total_desc','total_asc'].includes(sortQ) ? sortQ : 'created_desc');
    setPage(Number.isFinite(pg) && pg > 0 ? pg : 1);
    setPageSize([10,20,50].includes(ps) ? ps : 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push state to query params
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (status !== 'all') params.set('status', status);
    if (sort !== 'created_desc') params.set('sort', sort);
    if (page !== 1) params.set('page', String(page));
    if (pageSize !== 10) params.set('pageSize', String(pageSize));
    const qs = params.toString();
    routerNav.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  }, [search, status, sort, page, pageSize, routerNav, pathname]);

  // Debounce search input → search (250ms)
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const renderStatusBadge = (status: string) => {
    const key = status?.toLowerCase?.() || 'draft';
    if (key === 'accepted') return <Badge variant="success" className="capitalize">{status}</Badge>;
    if (key === 'rejected') return <Badge variant="destructive" className="capitalize">{status}</Badge>;
    if (key === 'sent') return <Badge variant="secondary" className="capitalize">Pending</Badge>;
    return <Badge variant="outline" className="capitalize">{status || 'draft'}</Badge>;
  };

  // Derived list (filters + sort + pagination)
  const filtered = quotes
    .filter((q) => {
      const matchesSearch = search
        ? q.quote_number.toLowerCase().includes(search.toLowerCase()) ||
          (q.customer?.name || '').toLowerCase().includes(search.toLowerCase())
        : true;
      const matchesStatus = status === 'all' ? true : q.status === status;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      switch (sort) {
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'total_desc':
          return b.grand_total - a.grand_total;
        case 'total_asc':
          return a.grand_total - b.grand_total;
        case 'created_desc':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageStart = (clampedPage - 1) * pageSize;
  const paged = filtered.slice(pageStart, pageStart + pageSize);

  const handleHeaderSort = (col: 'created' | 'total') => {
    if (col === 'created') {
      setSort((s) => (s === 'created_desc' ? 'created_asc' : 'created_desc'));
    } else {
      setSort((s) => (s === 'total_desc' ? 'total_asc' : 'total_desc'));
    }
  };

  const requestDelete = (id: string) => {
    setDeleteId(id);
    setConfirmOpen(true);
  };

  const performDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/quotes/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setQuotes((prev) => prev.filter((q) => q.id !== deleteId));
      toast({ title: 'Quote deleted', description: 'The quote was removed successfully.' });
    } catch (err: any) {
      console.error('Delete failed', err);
      toast({ title: 'Delete failed', description: 'Could not delete the quote.', variant: 'destructive' });
    } finally {
      setConfirmOpen(false);
      setDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-foreground">Loading Quotes...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Card className="rounded-2xl border bg-card shadow-sm">
          <CardHeader className="gap-4 border-b bg-card md:flex md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl text-foreground">Quotes Management</CardTitle>
              <CardDescription>Monitor quote activity, track status, and access PDF previews.</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button asChild size="sm" className="h-9 px-4">
                <Link href="/quotes/new">Create New Quote</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-9 px-4">
                <Link href="/pdf-quote-demo">View PDF Demo</Link>
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Failed to load</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Toolbar */}
            <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); }}
                  placeholder="Search quotes or customers"
                  className="h-9 w-full rounded-lg pl-9 pr-10 focus:ring-2 focus:ring-inset focus:ring-ring focus:ring-offset-0"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded hover:bg-muted"
                    onClick={() => setSearchInput('')}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
                <Select value={status} onValueChange={(v) => { setStatus(v as any); setPage(1); }}>
                  <SelectTrigger className="h-9 min-w-[10rem]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Pending</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => setSort(v as any)}>
                  <SelectTrigger className="h-9 min-w-[11rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_desc">Newest first</SelectItem>
                    <SelectItem value="created_asc">Oldest first</SelectItem>
                    <SelectItem value="total_desc">Total: high → low</SelectItem>
                    <SelectItem value="total_asc">Total: low → high</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-4">
              <Card className="rounded-xl border bg-background/80 shadow-sm">
                <CardContent className="space-y-2 p-4">
                  <div className="text-sm text-muted-foreground">Total Quotes</div>
                  <div className="text-2xl font-semibold text-foreground">{quotes.length}</div>
                </CardContent>
              </Card>
              <Card className="rounded-xl border bg-background/80 shadow-sm">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Accepted</div>
                    <Badge variant="success">OK</Badge>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {quotes.filter(q => q.status === 'accepted').length}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-xl border bg-background/80 shadow-sm">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Pending</div>
                    <Badge variant="secondary">Awaiting</Badge>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {quotes.filter(q => q.status === 'sent').length}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-xl border bg-background/80 shadow-sm">
                <CardContent className="space-y-2 p-4">
                  <div className="text-sm text-muted-foreground">Draft</div>
                  <div className="text-2xl font-semibold text-foreground">
                    {quotes.filter(q => q.status === 'draft').length}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <div
              ref={tableContainerRef}
              className={cn(
                "rounded-xl border bg-card shadow-sm transition-shadow",
                tableFlash && "ring-2 ring-ring"
              )}
            >
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Quote Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:underline"
                        onClick={() => handleHeaderSort('created')}
                        aria-label="Sort by created date"
                      >
                        Created
                        {sort === 'created_desc' ? ' ↓' : sort === 'created_asc' ? ' ↑' : ''}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className="flex items-center gap-1 hover:underline"
                        onClick={() => handleHeaderSort('total')}
                        aria-label="Sort by total"
                      >
                        Total
                        {sort === 'total_desc' ? ' ↓' : sort === 'total_asc' ? ' ↑' : ''}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                  {!loading && paged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        No quotes match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && paged.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => routerNav.push(`/quotes/${quote.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          routerNav.push(`/quotes/${quote.id}`);
                        }
                      }}
                      tabIndex={0}
                      aria-label={`Open quote ${quote.quote_number}`}
                    >
                      <TableCell>
                        <Link href={`/quotes/${quote.id}`} className="font-medium text-primary hover:underline">
                          {quote.quote_number}
                        </Link>
                      </TableCell>
                      <TableCell className="text-foreground">
                        {quote.customer?.name ? quote.customer.name : (quote.customer_id ? `Customer #${quote.customer_id}` : '—')}
                      </TableCell>
                      <TableCell>{renderStatusBadge(quote.status)}</TableCell>
                      <TableCell className="text-foreground">
                        {new Date(quote.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-medium text-foreground text-right">{formatCurrency(quote.grand_total)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="destructiveSoft"
                            size="sm"
                            className="h-8 px-2"
                            onClick={(e) => { e.stopPropagation(); requestDelete(quote.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {filtered.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
              </div>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / page</SelectItem>
                    <SelectItem value="20">20 / page</SelectItem>
                    <SelectItem value="50">50 / page</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={clampedPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm w-16 text-center">{clampedPage} / {totalPages}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={clampedPage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Success / Info */}
            <button
              className="mt-6 w-full text-left"
              onClick={() => {
                tableContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTableFlash(true);
                setTimeout(() => setTableFlash(false), 1200);
              }}
            >
              <Alert>
                <AlertTitle>Quotes System Operational</AlertTitle>
                <AlertDescription>
                  Tip: click any row to open and edit the quote. This banner is clickable to jump to the table.
                </AlertDescription>
              </Alert>
            </button>

            {/* Delete confirmation dialog */}
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this quote?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. All related items and attachments will be removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={performDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
