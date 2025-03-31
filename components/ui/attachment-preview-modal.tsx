'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from "@/components/ui/file-icon";
import { useState, useEffect } from 'react';
import { ChevronLeft, AlertCircle } from 'lucide-react';

// Define the attachment type
interface Attachment {
  attachment_id?: number;
  id?: number;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  file_type?: string;
}

// Define the props for our component
interface AttachmentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachments: Attachment[];
  orderNumber: string;
}

// Only use named export to avoid import confusion
export function AttachmentPreviewModal({ 
  isOpen, 
  onClose, 
  attachments = [], 
  orderNumber 
}: AttachmentPreviewModalProps) {
  // State to track the currently selected attachment for full-screen viewing
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  
  // Add states for tracking loading and errors
  const [loadingTimeoutReached, setLoadingTimeoutReached] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  // Enhanced file type detection function
  const getFileType = (attachment: Attachment | null): 'pdf' | 'image' | 'other' | null => {
    if (!attachment?.file_name) return null;
    
    try {
      // First try using file_type if available
      if (attachment.file_type) {
        const normalizedType = attachment.file_type.toLowerCase();
        if (normalizedType === 'pdf') return 'pdf';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(normalizedType)) return 'image';
      }
      
      // Fall back to extension detection
      const ext = getFileExtension(attachment.file_name);
      
      // Map extensions to types
      if (ext === 'pdf') return 'pdf';
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
      
      console.log(`File type detection: ${attachment.file_name} detected as 'other'`);
      return 'other';
    } catch (error) {
      console.error('Error in file type detection:', error);
      return 'other';
    }
  };
  
  // Safe file extension function with error handling
  const getFileExtension = (fileName: string): string => {
    if (!fileName) return '';
    try {
      const parts = fileName.split('.');
      return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    } catch (e) {
      console.warn('Error extracting file extension:', e);
      return '';
    }
  };

  // Add logging for selected attachment to help with debugging
  useEffect(() => {
    if (selectedAttachment) {
      console.log("Selected attachment details:", {
        id: selectedAttachment.id || selectedAttachment.attachment_id,
        fileName: selectedAttachment.file_name,
        fileUrl: selectedAttachment.file_url,
        fileType: selectedAttachment.file_type,
        extension: getFileExtension(selectedAttachment.file_name),
        detectedType: getFileType(selectedAttachment)
      });
      
      // Test if the URL is accessible
      console.log("Testing URL accessibility...");
      fetch(selectedAttachment.file_url, { method: 'HEAD' })
        .then(response => {
          console.log(`URL test response for ${selectedAttachment.file_name}:`, {
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('content-type'),
            contentDisposition: response.headers.get('content-disposition')
          });
        })
        .catch(error => {
          console.error(`URL test failed for ${selectedAttachment.file_name}:`, error.message);
        });
    }
  }, [selectedAttachment]);

  // FIX: Use useEffect instead of useState for the timeout
  // Only trigger the timeout when we have a selected attachment
  useEffect(() => {
    if (!selectedAttachment) return;
    
    // Reset timeout state when attachment changes
    setLoadingTimeoutReached(false);
    
    const timer = setTimeout(() => {
      setLoadingTimeoutReached(true);
    }, 5000);
    
    // Clear timeout on component unmount or when attachment changes
    return () => clearTimeout(timer);
  }, [selectedAttachment]);
  
  // Component for PDF preview with better error handling
  const PDFPreview = ({ url, fileName }: { url: string, fileName: string }) => {
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isChrome, setIsChrome] = useState(false);
    
    useEffect(() => {
      // Reset states when URL changes
      setHasError(false);
      setIsLoading(true);
      
      // Detect Chrome browser
      const userAgent = navigator.userAgent;
      const isChromeBrowser = /chrome/i.test(userAgent) && !/edg/i.test(userAgent);
      setIsChrome(isChromeBrowser);
      
      console.log("PDF Preview - Browser detection:", { 
        userAgent,
        isChrome: isChromeBrowser
      });
    }, [url]);
    
    // Chrome-specific PDF rendering with Google Docs viewer
    if (isChrome) {
      return (
        <div className="w-full h-[70vh] border rounded relative">
          <iframe 
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
            width="100%" 
            height="100%" 
            className="w-full h-full border-0"
            onLoad={() => {
              console.log("Google Docs viewer loaded");
              setIsLoading(false);
            }}
          />
          
          {isLoading && !loadingTimeoutReached && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
              <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
            </div>
          )}
          
          {loadingTimeoutReached && (
            <div className="absolute top-0 left-0 right-0 bg-yellow-50 p-2 text-yellow-800 text-xs text-center">
              The preview is taking longer than expected. Please be patient or try the direct download option.
            </div>
          )}
          
          <div className="p-2 bg-muted/20 text-xs text-muted-foreground">
            Having trouble with the preview? You can also 
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline mx-1"
              onClick={(e) => {
                e.stopPropagation();
                // Create a download link
                fetch(url)
                  .then(resp => resp.blob())
                  .then(blob => {
                    const fileUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = fileUrl;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(fileUrl);
                    document.body.removeChild(a);
                  });
              }}
            >
              download the file
            </a>
            or
            <a 
              href={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}`}
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline mx-1"
            >
              open in Google Docs Viewer
            </a>
          </div>
        </div>
      );
    }
    
    return (
      <div className="w-full h-[70vh] border rounded">
        {isLoading && !loadingTimeoutReached && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
            <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
          </div>
        )}
        
        {hasError ? (
          <div className="flex flex-col items-center justify-center h-full">
            <AlertCircle className="h-10 w-10 text-red-500 mb-2" />
            <p className="text-lg font-medium text-center">
              Unable to display PDF preview
            </p>
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-4 text-primary hover:underline"
            >
              Open PDF in new tab
            </a>
          </div>
        ) : (
          <iframe
            src={url}
            title={`PDF preview: ${fileName}`}
            width="100%"
            height="100%"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              console.warn('Error loading PDF:', fileName);
              setHasError(true);
              setIsLoading(false);
            }}
          />
        )}
        
        <div className="p-2 bg-muted/20 text-xs text-muted-foreground">
          If the PDF doesn't display, you can <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            open it in a new tab
          </a>
        </div>
      </div>
    );
  };
  
  // Component for Image preview with better error handling
  const ImagePreview = ({ url, fileName }: { url: string, fileName: string }) => {
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    
    useEffect(() => {
      // Reset states when URL changes
      setHasError(false);
      setIsLoading(true);
    }, [url]);
    
    return (
      <div className="flex flex-col items-center justify-center">
        {isLoading && !loadingTimeoutReached && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
            <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
          </div>
        )}
        
        {hasError ? (
          <div className="flex flex-col items-center justify-center p-8">
            <AlertCircle className="h-10 w-10 text-red-500 mb-2" />
            <p className="text-lg font-medium text-center">
              Unable to display image
            </p>
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-4 text-primary hover:underline"
            >
              Open image in new tab
            </a>
          </div>
        ) : (
          <img 
            src={url} 
            alt={fileName}
            className="max-w-full max-h-[70vh] object-contain"
            onLoad={() => setIsLoading(false)}
            onError={(e) => {
              console.warn('Error loading image:', fileName, url);
              setHasError(true);
              setIsLoading(false);
              // Force re-render to show error state
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>
    );
  };
  
  // Component for other file types
  const OtherFilePreview = ({ url, fileName }: { url: string, fileName: string }) => (
    <div className="flex flex-col items-center justify-center p-12 border rounded-lg bg-muted/10">
      <FileIcon 
        fileName={fileName}
        size={64}
      />
      <p className="mt-4 text-center">
        This file type cannot be previewed directly.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Download File
      </a>
    </div>
  );
  
  // Safe rendering function for selected attachment with error handling
  const renderFilePreview = () => {
    if (!selectedAttachment) return null;
    
    // Safe access to properties
    const fileName = selectedAttachment.file_name || 'Unknown File';
    const fileUrl = selectedAttachment.file_url || '';
    
    // Determine file type safely
    const fileType = getFileType(selectedAttachment);
    
    // Handle errors gracefully
    try {
      switch (fileType) {
        case 'pdf':
          return <PDFPreview url={fileUrl} fileName={fileName} />;
        case 'image':
          return <ImagePreview url={fileUrl} fileName={fileName} />;
        case 'other':
        default:
          return <OtherFilePreview url={fileUrl} fileName={fileName} />;
      }
    } catch (error) {
      console.error('Error rendering file preview:', error);
      setPreviewError(`Error displaying ${fileName}`);
      
      return (
        <div className="p-6 border rounded bg-red-50 text-red-800">
          <h3 className="font-medium text-lg">Error displaying attachment</h3>
          <p className="mt-2">There was a problem rendering this attachment.</p>
          <a
            href={fileUrl}
            target="_blank" 
            rel="noopener noreferrer"
            className="mt-4 inline-block text-primary hover:underline"
          >
            Open file in new tab
          </a>
        </div>
      );
    }
  };
  
  // Safe rendering function for attachments grid
  const renderAttachmentGrid = () => {
    if (!attachments || attachments.length === 0) {
      return (
        <div className="col-span-2 text-center p-8 border rounded-lg bg-muted/10">
          <p className="text-muted-foreground">No attachments available.</p>
        </div>
      );
    }

    return attachments.map((attachment, index) => {
      // Skip rendering for invalid attachments
      if (!attachment || !attachment.file_name || !attachment.file_url) {
        console.warn(`Attachment ${index} is missing required properties:`, attachment);
        return null;
      }
      
      // Generate a stable key
      const key = attachment.attachment_id || attachment.id || `attachment-${index}`;
      
      // Get file type
      const fileType = getFileType(attachment);
      const isPdf = fileType === 'pdf';
      
      // Check if we're in Chrome - avoid loading spinner issues
      const isChrome = typeof navigator !== 'undefined' && 
        /chrome/i.test(navigator.userAgent) && 
        !/edg/i.test(navigator.userAgent);
      
      return (
        <div
          key={key}
          className="p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors group cursor-pointer"
          onClick={() => setSelectedAttachment(attachment)}
        >
          <div>
            {isPdf ? (
              <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-muted/30 flex items-center justify-center relative">
                <PdfThumbnailClient 
                  url={attachment.file_url} 
                  width={240} 
                  height={320}
                  className="w-full h-full" 
                />
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/50 to-transparent p-2">
                  <p className="text-xs text-white truncate">{attachment.file_name}</p>
                </div>
              </div>
            ) : (
              <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-muted/30 flex items-center justify-center relative">
                <FileIcon 
                  fileName={attachment.file_name}
                  size={48}
                />
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/50 to-transparent p-2">
                  <p className="text-xs text-white truncate">{attachment.file_name}</p>
                </div>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="font-medium truncate">{attachment.file_name}</h4>
              <p className="text-sm text-muted-foreground">
                {attachment.uploaded_at ? new Date(attachment.uploaded_at).toLocaleDateString() : 'Unknown date'}
              </p>
              <p className="text-xs text-muted-foreground uppercase">
                {attachment.file_type || getFileExtension(attachment.file_name).toUpperCase() || 'UNKNOWN'}
              </p>
            </div>
          </div>
        </div>
      );
    });
  };

  // Main render function for selected attachment
  const renderSelectedAttachment = () => {
    if (!selectedAttachment) return null;

    return (
      <div className="space-y-4">
        <button 
          onClick={() => setSelectedAttachment(null)}
          className="flex items-center text-sm text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to all attachments
        </button>
        
        <h3 className="text-lg font-semibold">{selectedAttachment.file_name}</h3>
        
        {/* Render file preview with error handling */}
        {previewError ? (
          <div className="p-6 border rounded bg-red-50 text-red-800">
            <h3 className="font-medium">{previewError}</h3>
            <p className="mt-2">Please try opening the file directly instead.</p>
            <a
              href={selectedAttachment.file_url}
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-4 inline-block text-primary hover:underline"
            >
              Open file in new tab
            </a>
          </div>
        ) : (
          renderFilePreview()
        )}
      </div>
    );
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={selectedAttachment ? "sm:max-w-[900px]" : "sm:max-w-[800px]"}>
        <DialogHeader>
          <DialogTitle className="flex justify-between items-center">
            <span>Order {orderNumber} - Attachments</span>
          </DialogTitle>
          <div id="dialog-description" className="sr-only">
            View and manage attachments for order {orderNumber}
          </div>
        </DialogHeader>
        
        {/* Main content with error handling wrapper */}
        <div className="max-h-[80vh] overflow-y-auto">
          {selectedAttachment ? (
            renderSelectedAttachment()
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {renderAttachmentGrid()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Remove default export to avoid import confusion
// export default AttachmentPreviewModal; 