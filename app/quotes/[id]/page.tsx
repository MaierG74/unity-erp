'use client';

import { use } from 'react';
import EnhancedQuoteEditor from '@/components/quotes/EnhancedQuoteEditor';

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <EnhancedQuoteEditor quoteId={id} />;
}
