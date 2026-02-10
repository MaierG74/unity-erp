'use client';

import { useRef, useState, useMemo } from 'react';
import { Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { ImagePreview } from '@/components/ui/image-preview';
import { compressImage } from '@/lib/utils/image-compression';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];

interface DeliveryNoteUploadProps {
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
  disabled?: boolean;
  large?: boolean; // larger touch targets for Quick Upload page
}

export default function DeliveryNoteUpload({
  onFileSelect,
  selectedFile,
  disabled = false,
  large = false,
}: DeliveryNoteUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(() => {
    if (!selectedFile) return null;
    if (selectedFile.type.startsWith('image/')) {
      return URL.createObjectURL(selectedFile);
    }
    return null;
  }, [selectedFile]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      setError('File too large. Maximum size is 10MB.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Validate type
    const isAccepted =
      file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!isAccepted) {
      setError('Please select an image or PDF file.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Compress images
    if (file.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        const compressed = await compressImage(file);
        onFileSelect(compressed);
      } catch {
        onFileSelect(file); // fallback to original
      } finally {
        setIsCompressing(false);
      }
    } else {
      onFileSelect(file);
    }

    // Reset input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleRemove() {
    onFileSelect(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const isPdf = selectedFile?.type === 'application/pdf';

  return (
    <div className="space-y-2">
      {/* Hidden file input — NO capture attribute */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isCompressing}
      />

      {/* Upload area or preview */}
      {!selectedFile && !isCompressing ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className={cn(
            'w-full border-2 border-dashed border-muted-foreground/30 rounded-lg flex items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors',
            large ? 'p-6 min-h-[80px]' : 'p-3',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Paperclip className={cn(large ? 'h-5 w-5' : 'h-4 w-4')} />
          <div className={cn('text-left', large && 'text-base')}>
            <span className={cn('font-medium', large ? 'text-sm' : 'text-xs')}>
              Attach delivery note (optional)
            </span>
            <span className={cn('block text-muted-foreground/70', large ? 'text-xs' : 'text-[10px]')}>
              Photo or PDF
            </span>
          </div>
        </button>
      ) : isCompressing ? (
        <div className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-3 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Compressing image...</span>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30">
          {previewUrl && !isPdf ? (
            <ImagePreview src={previewUrl} alt="Delivery note" onRemove={handleRemove} />
          ) : isPdf ? (
            <div className="relative group">
              <div className="h-20 w-20 rounded-md bg-muted flex flex-col items-center justify-center border border-border">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground mt-1">PDF</span>
              </div>
              <button
                type="button"
                onClick={handleRemove}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedFile?.name}</p>
            <p className="text-xs text-muted-foreground">
              {selectedFile && formatFileSize(selectedFile.size)}
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
