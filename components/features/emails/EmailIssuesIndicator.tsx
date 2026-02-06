'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AlertTriangle, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface EmailIssue {
  id: string;
  event_type: string;
  recipient_email: string;
  subject?: string | null;
  event_timestamp: string;
  purchase_order_id?: number | null;
  purchase_order_number?: string | null;
  quote_id?: string;
  bounce_message?: string;
}

const DISMISSED_STORAGE_KEY = 'unity-email-issues-dismissed-v1';

export function EmailIssuesIndicator() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['email-issues'],
    queryFn: async () => {
      const response = await fetch('/api/email-issues');
      if (!response.ok) {
        throw new Error('Failed to fetch email issues');
      }
      return response.json();
    },
    refetchInterval: 60000, // Check every minute
    staleTime: 30000,
  });

  const issues: EmailIssue[] = data?.issues || [];
  const activeIssues = issues.filter((issue) => !dismissed.has(issue.id));
  const issueCount = activeIssues.length;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const storedIds = parsed.filter(
          (value): value is string => typeof value === 'string'
        );
        setDismissed(new Set(storedIds));
      }
    } catch (error) {
      console.warn('Failed to load dismissed email issues', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        DISMISSED_STORAGE_KEY,
        JSON.stringify(Array.from(dismissed))
      );
    } catch (error) {
      console.warn('Failed to persist dismissed email issues', error);
    }
  }, [dismissed]);

  useEffect(() => {
    if (issues.length === 0 || dismissed.size === 0) return;

    const activeIssueIds = new Set(issues.map((issue) => issue.id));
    let changed = false;
    const nextDismissed = new Set<string>();

    dismissed.forEach((id) => {
      if (activeIssueIds.has(id)) {
        nextDismissed.add(id);
      } else {
        changed = true;
      }
    });

    if (changed) {
      setDismissed(nextDismissed);
    }
  }, [issues, dismissed]);

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  const handleDismissAll = () => {
    setDismissed(new Set(issues.map((i) => i.id)));
    setOpen(false);
  };

  const handleResetDismissed = () => {
    setDismissed(new Set());
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (isLoading || issues.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            issueCount > 0
              ? `${issueCount} email delivery issues`
              : 'Email delivery issues (all dismissed)'
          }
        >
          <Mail className="h-5 w-5" />
          {issueCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {issueCount > 9 ? '9+' : issueCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-medium">Email Delivery Issues</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={handleDismissAll}
          >
            Dismiss All
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {activeIssues.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No active issues
              {dismissed.size > 0 && (
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={handleResetDismissed}
                  >
                    Reset dismissed items
                  </Button>
                </div>
              )}
            </div>
          ) : (
            activeIssues.map((issue) => (
              <div
                key={issue.id}
                className={cn(
                  'p-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors',
                  issue.event_type === 'bounced' && 'bg-destructive/5'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={
                          issue.event_type === 'bounced'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-xs"
                      >
                        {issue.event_type === 'bounced' ? 'Bounced' : 'Complaint'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(issue.event_timestamp)}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">
                      {issue.recipient_email}
                    </p>
                    {issue.subject && (
                      <p className="text-xs text-muted-foreground truncate">
                        {issue.subject}
                      </p>
                    )}
                    {issue.bounce_message && (
                      <p className="text-xs text-destructive mt-1 line-clamp-2">
                        {issue.bounce_message}
                      </p>
                    )}
                    <div className="mt-2">
                      {(issue.purchase_order_id || issue.purchase_order_number) &&
                        (issue.purchase_order_id ? (
                          <Link
                            href={`/purchasing/purchase-orders/${issue.purchase_order_id}`}
                            className="text-xs text-primary hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            View Purchase Order{' '}
                            {issue.purchase_order_number || `#${issue.purchase_order_id}`}
                          </Link>
                        ) : (
                          <Link
                            href={`/purchasing/purchase-orders?q=${encodeURIComponent(
                              issue.purchase_order_number || ''
                            )}`}
                            className="text-xs text-primary hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            Find Purchase Order {issue.purchase_order_number}
                          </Link>
                        ))}
                      {issue.quote_id && (
                        <Link
                          href={`/quotes/${issue.quote_id}/edit`}
                          className="text-xs text-primary hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          View Quote
                        </Link>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => handleDismiss(issue.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
