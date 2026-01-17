'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Mail,
  Check,
  X,
  AlertTriangle,
  Clock,
  Eye,
  MousePointerClick,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmailActivity {
  id: string;
  recipient_email: string;
  cc_emails?: string[];
  sent_at: string;
  delivery_status: string;
  delivered_at?: string;
  bounced_at?: string;
  bounce_reason?: string;
  message_id?: string;
  resend_message_id?: string;
  events: Array<{
    event_type: string;
    event_timestamp: string;
    bounce_message?: string;
    bounce_type?: string;
  }>;
  has_bounced: boolean;
  has_complained: boolean;
  has_delivered: boolean;
  has_opened: boolean;
  has_clicked: boolean;
}

interface EmailActivityCardProps {
  type: 'purchase-order' | 'quote';
  id: string;
}

export function EmailActivityCard({ type, id }: EmailActivityCardProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['email-status', type, id],
    queryFn: async () => {
      const endpoint = type === 'purchase-order'
        ? `/api/email-status/purchase-orders/${id}`
        : `/api/email-status/quotes/${id}`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch email status');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const emails: EmailActivity[] = data?.emails || [];
  const hasProblems = emails.some((e) => e.has_bounced || e.has_complained);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading email status...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load email status</p>
        </CardContent>
      </Card>
    );
  }

  if (emails.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Activity
          </CardTitle>
          <CardDescription>No emails sent yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Activity
          {hasProblems && (
            <Badge variant="destructive" className="ml-auto">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Issues Detected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {emails.length} email{emails.length === 1 ? '' : 's'} sent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Alert for bounced/complained emails */}
        {hasProblems && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Email Delivery Issues</AlertTitle>
            <AlertDescription>
              Some emails have bounced or been marked as spam. Please verify the recipient email addresses and try resending.
            </AlertDescription>
          </Alert>
        )}

        {/* Email list */}
        <div className="space-y-3">
          {emails.map((email) => (
            <EmailItem key={email.id} email={email} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmailItem({ email }: { email: EmailActivity }) {
  const [expanded, setExpanded] = useState(false);

  const getStatusBadge = () => {
    if (email.has_bounced) {
      return (
        <Badge variant="destructive" className="gap-1">
          <X className="h-3 w-3" />
          Bounced
        </Badge>
      );
    }
    if (email.has_complained) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Spam Complaint
        </Badge>
      );
    }
    if (email.has_delivered) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <Check className="h-3 w-3" />
          Delivered
        </Badge>
      );
    }
    if (email.delivery_status === 'sent') {
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Sent
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        {email.delivery_status}
      </Badge>
    );
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-ZA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className={cn(
      "border rounded-lg p-3 space-y-2",
      (email.has_bounced || email.has_complained) && "border-destructive bg-destructive/5"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{email.recipient_email}</span>
            {getStatusBadge()}
            {email.has_opened && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Eye className="h-3 w-3" />
                Opened
              </Badge>
            )}
            {email.has_clicked && (
              <Badge variant="outline" className="gap-1 text-xs">
                <MousePointerClick className="h-3 w-3" />
                Clicked
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sent {formatDateTime(email.sent_at)}
          </p>
          {email.cc_emails && email.cc_emails.length > 0 && (
            <p className="text-xs text-muted-foreground">
              CC: {email.cc_emails.join(', ')}
            </p>
          )}
        </div>
        {email.events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Bounce/complaint reason */}
      {email.bounce_reason && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription className="text-xs">
            <strong>Reason:</strong> {email.bounce_reason}
          </AlertDescription>
        </Alert>
      )}

      {/* Event timeline */}
      {expanded && email.events.length > 0 && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-medium">Event Timeline</p>
          <div className="space-y-1.5">
            {email.events.map((event, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatDateTime(event.event_timestamp)}
                </span>
                <span className="font-medium capitalize">
                  {event.event_type.replace('_', ' ')}
                </span>
                {event.bounce_message && (
                  <span className="text-muted-foreground truncate">
                    - {event.bounce_message}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
