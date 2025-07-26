'use client';

import { useState, useEffect, ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchQuote, updateQuote, uploadQuoteAttachment, Quote, QuoteItem, QuoteAttachment } from '@/lib/db/quotes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import QuoteItemsTable from '@/components/features/quotes/QuoteItemsTable';
import QuoteAttachmentsList from '@/components/features/quotes/QuoteAttachmentsList';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

export default function QuoteEditorPage() {
  const params = useParams();
  const id = String(params.id); // ensure id is string
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);

  useEffect(() => {
    if (id) {
      fetchQuote(id)
        .then(data => {
          setQuote(data);
          setItems(data.items);
          setAttachments(data.attachments);
        })
        .catch(console.error);
    }
  }, [id]);

  if (!quote) return <div>Loading...</div>;

  const handleFieldChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setQuote({ ...quote, [name]: value });
  };

  const handleSave = async () => {
    try {
      await updateQuote(quote.id, {
        quote_number: quote.quote_number,
        status: quote.status,
        customer_id: quote.customer_id,
      });
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const att = await uploadQuoteAttachment(file, quote.id);
        setAttachments(prev => [...prev, att]);
      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Edit Quote</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium">Quote #</label>
          <Input name="quote_number" value={quote.quote_number} onChange={handleFieldChange} />
        </div>
        <div>
          <label className="block text-sm font-medium">Customer ID</label>
          <Input name="customer_id" value={quote.customer_id} onChange={handleFieldChange} />
        </div>
        <div>
          <label className="block text-sm font-medium">Status</label>
          <Select defaultValue={quote.status} onValueChange={(value: string) => setQuote({ ...quote, status: value })}>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="Status" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="draft">Draft</SelectItem>
    <SelectItem value="in_progress">In Progress</SelectItem>
    <SelectItem value="sent">Sent</SelectItem>
    <SelectItem value="won">Won</SelectItem>
    <SelectItem value="lost">Lost</SelectItem>
  </SelectContent>
</Select>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Items</h2>
        <QuoteItemsTable
          quoteId={quote.id}
          items={items}
          onItemsChange={setItems}
        />
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Attachments</h2>
        <QuoteAttachmentsList
          quoteId={quote.id}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </div>

      <div className="flex space-x-2">
        <Button onClick={handleSave}>Save</Button>
        <Button variant="ghost" onClick={() => router.push('/quotes')}>Cancel</Button>
      </div>
    </div>
  );
}
