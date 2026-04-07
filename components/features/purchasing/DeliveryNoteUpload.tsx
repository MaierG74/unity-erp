'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { ImagePreview } from '@/components/ui/image-preview';
import { compressImage } from '@/lib/utils/image-compression';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const DELIVERY_NOTE_ACCEPT = {
  'image/*': ['.png', '.jpg', '.jpeg', '.heic', '.heif', '.gif', '.bmp', '.webp'],
  'application/pdf': ['.pdf'],
} as const;

const DOCUMENT_ACCEPT = {
  ...DELIVERY_NOTE_ACCEPT,
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
} as const;

type UploadMode = 'delivery-note' | 'document';

interface DeliveryNoteUploadProps {
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
  disabled?: boolean;
  large?: boolean; // larger touch targets for Quick Upload page
  buttonTitle?: string;
  buttonSubtitle?: string;
  previewAlt?: string;
  uploadMode?: UploadMode;
}

export default function DeliveryNoteUpload({
  onFileSelect,
  selectedFile,
  disabled = false,
  large = false,
  buttonTitle = 'Attach delivery note (optional)',
  buttonSubtitle = 'Photo or PDF',
  previewAlt = 'Delivery note',
  uploadMode = 'delivery-note',
}: DeliveryNoteUploadProps) {
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const accept = uploadMode === 'document' ? DOCUMENT_ACCEPT : DELIVERY_NOTE_ACCEPT;
  const acceptsDocuments = uploadMode === 'document';

  useEffect(() => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  const validateFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      return 'File too large. Maximum size is 10MB.';
    }

    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      return null;
    }

    if (acceptsDocuments && isAllowedDocumentType(file)) {
      return null;
    }

    return acceptsDocuments
      ? 'Please select an image, PDF, Word, Excel, text, or CSV file.'
      : 'Please select an image or PDF file.';
  }, [acceptsDocuments]);

  const processIncomingFile = useCallback(async (incomingFile: File | null) => {
    if (!incomingFile) return;

    const file = ensureFileHasName(incomingFile);
    setError(null);

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (file.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        const compressed = await compressImage(file);
        onFileSelect(compressed);
      } catch {
        onFileSelect(file);
      } finally {
        setIsCompressing(false);
      }
      return;
    }

    onFileSelect(file);
  }, [onFileSelect, validateFile]);

  const handleDrop = useCallback(async (acceptedFiles: File[]) => {
    await processIncomingFile(acceptedFiles[0] ?? null);
  }, [processIncomingFile]);

  const handleDropRejected = useCallback((rejections: FileRejection[]) => {
    const firstError = rejections[0]?.errors[0];
    if (!firstError) return;

    if (firstError.code === 'file-too-large') {
      setError('File too large. Maximum size is 10MB.');
      return;
    }

    setError(
      acceptsDocuments
        ? 'Please select an image, PDF, Word, Excel, text, or CSV file.'
        : 'Please select an image or PDF file.'
    );
  }, [acceptsDocuments]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: handleDrop,
    onDropRejected: handleDropRejected,
    accept,
    multiple: false,
    maxSize: MAX_FILE_SIZE,
    noClick: true,
    noKeyboard: true,
    disabled: disabled || isCompressing,
  });

  const handlePaste = useCallback(async (clipboardData: DataTransfer | null | undefined) => {
    if (!clipboardData) return false;

    const files = Array.from(clipboardData.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      return false;
    }

    await processIncomingFile(files[0]);
    return true;
  }, [processIncomingFile]);

  useEffect(() => {
    if (disabled || isCompressing || selectedFile) {
      return;
    }

    function handleWindowPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      void handlePaste(event.clipboardData).then((handled) => {
        if (handled) {
          event.preventDefault();
        }
      });
    }

    window.addEventListener('paste', handleWindowPaste);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
    };
  }, [disabled, handlePaste, isCompressing, selectedFile]);

  function handleRemove() {
    setError(null);
    onFileSelect(null);
  }

  const fileLabel = selectedFile ? getFileLabel(selectedFile) : null;

  return (
    <div className="space-y-2">
      {/* Upload area or preview */}
      {!selectedFile && !isCompressing ? (
        <div
          {...getRootProps()}
          onClick={() => {
            if (!disabled) {
              open();
            }
          }}
          title="Click to browse, drag and drop, or paste from clipboard"
          tabIndex={0}
          className={cn(
            'w-full border-2 border-dashed rounded-lg flex items-center justify-center gap-2 text-muted-foreground transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring',
            large ? 'p-6 min-h-[96px]' : 'p-3',
            isDragActive
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-muted-foreground/30 hover:border-primary/50 hover:text-primary',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <input {...getInputProps()} />
          <Paperclip className={cn(large ? 'h-5 w-5' : 'h-4 w-4')} />
          <div className={cn('text-left', large && 'text-base')}>
            <span className={cn('font-medium', large ? 'text-sm' : 'text-xs')}>
              {buttonTitle}
            </span>
            <span className={cn('block text-muted-foreground/70', large ? 'text-xs' : 'text-[10px]')}>
              {buttonSubtitle}
            </span>
            <span className={cn('block text-muted-foreground/60', large ? 'text-[11px]' : 'text-[10px]')}>
              {isDragActive
                ? 'Drop the file here'
                : 'Click, drag and drop, or paste with Ctrl/Cmd+V'}
            </span>
          </div>
        </div>
      ) : isCompressing ? (
        <div className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-3 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Compressing image...</span>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30">
          {previewUrl ? (
            <ImagePreview src={previewUrl} alt={previewAlt} onRemove={handleRemove} />
          ) : (
            <div className="relative group">
              <div className="h-20 w-20 rounded-md bg-muted flex flex-col items-center justify-center border border-border">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground mt-1">{fileLabel}</span>
              </div>
              <button
                type="button"
                onClick={handleRemove}
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
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

function isAllowedDocumentType(file: File): boolean {
  return [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ].includes(file.type);
}

function ensureFileHasName(file: File): File {
  if (file.name) {
    return file;
  }

  const extension = getExtensionFromMimeType(file.type);
  return new File([file], `clipboard-${Date.now()}.${extension}`, {
    type: file.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

function getFileLabel(file: File): string {
  if (file.type === 'application/pdf') {
    return 'PDF';
  }

  const extension = file.name.split('.').pop()?.toUpperCase();
  if (extension) {
    return extension.slice(0, 4);
  }

  return 'FILE';
}

function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'text/plain':
      return 'txt';
    case 'text/csv':
      return 'csv';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'bin';
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}
