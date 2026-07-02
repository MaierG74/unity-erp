'use client';

import { FileText, UploadCloud, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

import { Button } from '@/components/ui/button';

export const INVOICE_FILE_ACCEPT = {
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
};

type FileDropFieldProps = {
  file: File | null;
  onFile: (file: File | null) => void;
  hint: string;
  disabled?: boolean;
};

export default function FileDropField({
  file,
  onFile,
  hint,
  disabled,
}: FileDropFieldProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted: File[]) => {
      if (accepted.length > 0) onFile(accepted[0]);
    },
    accept: INVOICE_FILE_ACCEPT,
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    disabled,
  });

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{file.name}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onFile(null)}
          disabled={disabled}
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm transition-colors ${
        isDragActive ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <input {...getInputProps()} />
      <UploadCloud className="h-6 w-6 text-muted-foreground" />
      <span className="text-muted-foreground">{hint}</span>
    </div>
  );
}
