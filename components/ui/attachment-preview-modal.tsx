'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from "@/components/ui/file-icon";
import { useState, useEffect } from 'react';
import { ChevronLeft, AlertCircle, RefreshCw } from 'lucide-react';

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
  initialAttachmentId?: number | null;
}

// Only use named export to avoid import confusion
export function AttachmentPreviewModal({
  isOpen,
  onClose,
  attachments = [],
  orderNumber,
  initialAttachmentId = null
}: AttachmentPreviewModalProps) {
  // State to track the currently selected attachment for full-screen viewing
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  
  // Add states for tracking loading and errors
  const [loadingTimeoutReached, setLoadingTimeoutReached] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preloadedImages, setPreloadedImages] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadedPdfs, setLoadedPdfs] = useState<Record<string, boolean>>({});
  
  // Force refresh thumbnails when modal opens and pre-fetch PDFs
  useEffect(() => {
    if (isOpen) {
      // Reset all states and force a re-render of all components
      setRefreshKey(prev => prev + 1);
      setPreloadedImages({});
      setLoadedPdfs({});
      console.log("Modal opened - forcing refresh of all thumbnails");

      // Pre-fetch all PDF files
      const pdfAttachments = attachments.filter(attachment => {
        const fileName = attachment.file_name || "";
        return fileName.toLowerCase().endsWith('.pdf');
      });

      console.log(`Pre-fetching ${pdfAttachments.length} PDF attachments...`);

      // Initialize loadedPdfs state for tracking
      const initialPdfState: Record<string, boolean> = {};
      pdfAttachments.forEach(pdf => {
        initialPdfState[pdf.file_url] = false;
      });
      setLoadedPdfs(initialPdfState);

      // Fetch each PDF with cache forcing
      pdfAttachments.forEach(pdf => {
        preFetchPdf(pdf.file_url);
      });

      // Set initial attachment if provided
      if (initialAttachmentId !== null) {
        const initialAttachment = attachments.find(
          att => (att.attachment_id || att.id) === initialAttachmentId
        );
        if (initialAttachment) {
          console.log("Setting initial attachment:", initialAttachment.file_name);
          setSelectedAttachment(initialAttachment);
        }
      } else {
        // Reset selected attachment if no initial ID provided
        setSelectedAttachment(null);
      }
    }
  }, [isOpen, attachments, initialAttachmentId]);
  
  // Function to pre-fetch PDF content with multiple retries
  const preFetchPdf = async (url: string) => {
    console.log(`Pre-fetching PDF: ${url}`);
    
    const fetchWithRetry = async (attempts = 3) => {
      for (let i = 0; i < attempts; i++) {
        try {
          // Use a cache-busting query parameter
          const cacheBuster = `?cache=${Date.now()}-${i}`;
          const fetchUrl = url.includes('?') ? `${url}&_cb=${Date.now()}-${i}` : `${url}${cacheBuster}`;
          
          console.log(`PDF fetch attempt ${i+1}/${attempts}: ${fetchUrl}`);
          
          // Create an abort controller with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          
          const response = await fetch(fetchUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Accept': 'application/pdf',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            },
            cache: 'reload'
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          // Just get the first few bytes to validate it's a PDF
          const blob = await response.blob();
          console.log(`Successfully pre-fetched PDF (${blob.size} bytes)`);
          
          // Mark as successfully loaded
          setLoadedPdfs(prev => ({...prev, [url]: true}));
          return true;
        } catch (error) {
          console.warn(`PDF pre-fetch attempt ${i+1} failed:`, error);
          
          if (i === attempts - 1) {
            console.error(`All pre-fetch attempts failed for ${url}`);
            return false;
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return false;
    };
    
    return fetchWithRetry();
  };
  
  // Preload image thumbnails when component mounts or attachments change
  useEffect(() => {
    // Only attempt preloading when modal is open
    if (!isOpen) return;
    
    console.log("Preloading image thumbnails for attachments");
    
    // Find image attachments
    const imageAttachments = attachments.filter(attachment => {
      const fileType = getFileType(attachment);
      return fileType === 'image';
    });
    
    // Preload each image
    const preloadStatus: Record<string, boolean> = {};
    
    imageAttachments.forEach(attachment => {
      if (!attachment.file_url) return;
      
      console.log(`Preloading image: ${attachment.file_name}`);
      
      // Create a new image element to preload
      const img = new Image();
      
      img.onload = () => {
        console.log(`Successfully preloaded: ${attachment.file_name}`);
        preloadStatus[attachment.file_url] = true;
        // Update state if all images are loaded
        if (Object.keys(preloadStatus).length === imageAttachments.length) {
          setPreloadedImages(preloadStatus);
        }
      };
      
      img.onerror = () => {
        console.warn(`Failed to preload: ${attachment.file_name}`);
        preloadStatus[attachment.file_url] = false;
        // Update state regardless of failure
        if (Object.keys(preloadStatus).length === imageAttachments.length) {
          setPreloadedImages(preloadStatus);
        }
      };
      
      // Start loading the image
      img.src = attachment.file_url;
    });
  }, [isOpen, attachments]);
  
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
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    
    // Reset states when URL changes
    useEffect(() => {
      setHasError(false);
      setIsLoading(true);
      setZoomLevel(1);
      setPosition({ x: 0, y: 0 });
    }, [url]);
    
    // Handle zoom in
    const zoomIn = () => {
      setZoomLevel(prev => Math.min(prev + 0.25, 3));
    };
    
    // Handle zoom out
    const zoomOut = () => {
      setZoomLevel(prev => {
        const newZoom = Math.max(prev - 0.25, 0.5);
        // If zooming back to 1, reset position
        if (newZoom === 1) {
          setPosition({ x: 0, y: 0 });
        }
        return newZoom;
      });
    };
    
    // Handle reset view
    const resetView = () => {
      setZoomLevel(1);
      setPosition({ x: 0, y: 0 });
    };
    
    // Download image
    const downloadImage = () => {
      fetch(url)
        .then(resp => resp.blob())
        .then(blob => {
          const fileUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = fileUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(fileUrl);
          document.body.removeChild(a);
        })
        .catch(error => console.error("Image download error:", error));
    };
    
    // Handle mouse events for panning
    const handleMouseDown = (e: React.MouseEvent) => {
      if (zoomLevel > 1) {
        setIsPanning(true);
      }
    };
    
    const handleMouseMove = (e: React.MouseEvent) => {
      if (isPanning && zoomLevel > 1) {
        setPosition(prev => ({
          x: prev.x + e.movementX,
          y: prev.y + e.movementY
        }));
      }
    };
    
    const handleMouseUp = () => {
      setIsPanning(false);
    };
    
    return (
      <div className="flex flex-col items-center">
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
          <div className="w-full">
            {/* Image container */}
            <div 
              className="relative overflow-hidden w-full h-[60vh] flex items-center justify-center bg-muted/20"
              style={{ cursor: zoomLevel > 1 ? 'grab' : 'default' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <img 
                src={url} 
                alt={fileName}
                className="max-w-full max-h-full object-contain transition-transform duration-100"
                style={{ 
                  transform: `scale(${zoomLevel}) translate(${position.x}px, ${position.y}px)`,
                  transformOrigin: 'center' 
                }}
                onLoad={() => setIsLoading(false)}
                onError={(e) => {
                  console.warn('Error loading image:', fileName, url);
                  setHasError(true);
                  setIsLoading(false);
                  // Force re-render to show error state
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            
            {/* Controls */}
            <div className="flex items-center justify-between mt-4 px-2">
              <div className="flex items-center gap-2">
                <button 
                  onClick={zoomOut}
                  disabled={zoomLevel <= 0.5}
                  className="p-2 rounded-full bg-muted hover:bg-muted/70 disabled:opacity-50"
                  title="Zoom Out"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                </button>
                <span className="text-sm text-muted-foreground">{Math.round(zoomLevel * 100)}%</span>
                <button 
                  onClick={zoomIn}
                  disabled={zoomLevel >= 3}
                  className="p-2 rounded-full bg-muted hover:bg-muted/70 disabled:opacity-50"
                  title="Zoom In"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                </button>
                <button 
                  onClick={resetView}
                  className="p-2 rounded-full bg-muted hover:bg-muted/70 ml-2"
                  title="Reset View"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                </button>
              </div>
              
              <div>
                <button
                  onClick={downloadImage}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download
                </button>
              </div>
            </div>
          </div>
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
      const key = `${attachment.attachment_id || attachment.id || `attachment-${index}`}-${refreshKey}`;
      
      // Get file type
      const fileType = getFileType(attachment);
      const isPdf = fileType === 'pdf';
      const isImage = fileType === 'image';
      
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
                  key={`pdf-${key}`}
                  url={attachment.file_url} 
                  width={240} 
                  height={320}
                  className="w-full h-full" 
                />
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/50 to-transparent p-2">
                  <p className="text-xs text-white truncate">{attachment.file_name}</p>
                </div>
              </div>
            ) : isImage ? (
              <div className="mb-3 aspect-[3/4] border rounded overflow-hidden bg-white flex items-center justify-center relative">
                {/* Simple, reliable image thumbnail */}
                <div className="w-full h-full flex items-center justify-center p-3">
                  <div className="relative w-full h-full flex items-center justify-center">
                    {/* Loading indicator */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
                    </div>
                    
                    {/* Actual image */}
                    <img 
                      key={`img-${key}`}
                      src={attachment.file_url}
                      alt={attachment.file_name}
                      className="max-w-full max-h-full object-contain z-10"
                      style={{ 
                        backgroundColor: 'white',
                        maxHeight: '100%'
                      }}
                      onLoad={(e) => {
                        console.log(`Image thumbnail loaded: ${attachment.file_name}`);
                        // Hide the loading spinner by updating parent's status
                        const target = e.currentTarget;
                        const container = target.closest('.relative');
                        const spinner = container?.querySelector('.animate-spin')?.parentElement;
                        if (spinner) {
                          spinner.style.display = 'none';
                        }
                      }}
                      onError={(e) => {
                        console.warn(`Error loading image thumbnail: ${attachment.file_name}`, attachment.file_url);
                        // Show fallback
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        const container = target.closest('.relative');
                        if (container) {
                          // Hide the spinner
                          const spinner = container.querySelector('.animate-spin')?.parentElement;
                          if (spinner) {
                            spinner.style.display = 'none';
                          }
                          
                          // Show file icon instead
                          const fallback = document.createElement('div');
                          fallback.className = 'flex items-center justify-center h-full w-full';
                          fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                          container.appendChild(fallback);
                        }
                      }}
                    />
                  </div>
                </div>
                
                {/* Image label */}
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/60 to-transparent p-2 z-20">
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
  
  // Function to handle manual refresh
  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
    setPreloadedImages({});
    setLoadedPdfs({});
    setIsRefreshing(true);
    console.log("Manual refresh triggered - reloading all thumbnails");
    
    // Pre-fetch all PDFs again
    const pdfAttachments = attachments.filter(attachment => {
      const fileName = attachment.file_name || "";
      return fileName.toLowerCase().endsWith('.pdf');
    });
    
    console.log(`Re-fetching ${pdfAttachments.length} PDF attachments...`);
    pdfAttachments.forEach(pdf => {
      preFetchPdf(pdf.file_url);
    });
    
    // Clear the refreshing state after animation
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={selectedAttachment ? "sm:max-w-[900px]" : "sm:max-w-[800px]"}>
        <DialogHeader>
          <DialogTitle className="flex justify-between items-center">
            <span>Order {orderNumber} - Attachments</span>
            
            {/* More prominent refresh button */}
            <button 
              onClick={handleRefresh}
              className="bg-primary text-white px-3 py-1.5 rounded-md flex items-center gap-1.5 hover:bg-primary/90 transition-colors shadow-sm"
              title="Refresh thumbnails"
              aria-label="Refresh thumbnails"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">Refresh</span>
              {isRefreshing && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                </span>
              )}
            </button>
          </DialogTitle>
          <div id="dialog-description" className="sr-only">
            View and manage attachments for order {orderNumber}
          </div>
        </DialogHeader>
        
        {/* Main content with error handling wrapper */}
        <div className="max-h-[80vh] overflow-y-auto">
          {isRefreshing && (
            <div className="absolute top-12 right-0 left-0 flex justify-center">
              <div className="bg-primary text-white text-sm py-1 px-3 rounded-md shadow-md z-50">
                Refreshing thumbnails...
              </div>
            </div>
          )}
          
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