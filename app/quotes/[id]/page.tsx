'use client';

import EnhancedQuoteEditor from '@/components/quotes/EnhancedQuoteEditor';

export default function QuotePage({ params }: { params: { id: string } }) {
  return <EnhancedQuoteEditor quoteId={params.id} />;
}
