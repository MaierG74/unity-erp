'use client';

import { ChangeEvent } from 'react';
import {
  QuoteAttachment,
  uploadQuoteAttachment,
  deleteQuoteAttachment,
} from '@/lib/db/quotes';
import { Button } from '@/components/ui/button';

interface Props {
  quoteId: string;
  attachments: QuoteAttachment[];
  onAttachmentsChange: (attachments: QuoteAttachment[]) => void;
}

export default function QuoteAttachmentsList({ quoteId, attachments, onAttachmentsChange }: Props) {
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const file = e.target.files[0];
      try {
        const att = await uploadQuoteAttachment(file, quoteId);
        onAttachmentsChange([...attachments, att]);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuoteAttachment(id);
      onAttachmentsChange(attachments.filter(a => a.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <Button onClick={() => document.getElementById('qa-upload')?.click()} size="sm" className="mb-2">
        Upload Attachment
      </Button>
      <input id="qa-upload" type="file" className="hidden" onChange={handleFileChange} />
      <div className="grid grid-cols-2 gap-4">
        {attachments.map(att => (
          <div key={att.id} className="border p-2 relative">
            {att.mime_type.startsWith('image/') ? (
              <img src={att.file_url} alt={att.file_url.split('/').pop()} className="max-w-full h-auto" />
            ) : (
              <a href={att.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {att.file_url.split('/').pop()}
              </a>
            )}
            <Button
              variant="destructive"
              size="xs"
              className="absolute top-1 right-1"
              onClick={() => handleDelete(att.id)}
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
