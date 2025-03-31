'use client';

import { FileText, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface PdfThumbnailClientProps {
  url: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * A client-side PDF thumbnail component that displays a PDF preview using object tags.
 * Enhanced version with better client-side error handling and browser compatibility.
 */
export function PdfThumbnailClient({ 
  url, 
  width = 200, 
  height = 250, 
  className = '' 
}: PdfThumbnailClientProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorType, setErrorType] = useState<'cors' | 'load' | 'unknown' | null>(null);
  const [isSafari, setIsSafari] = useState(false);
  const [isChrome, setIsChrome] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tryingBlob, setTryingBlob] = useState(false);
  
  // Enhanced debugging and fallback on mount
  useEffect(() => {
    // Log the component mount with URL
    console.log("PdfThumbnailClient mounted with URL:", url);
    
    // Detect browser - Fix browser detection logic
    const userAgent = navigator.userAgent;
    // Safari detection is more specific to avoid false positives
    const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(userAgent);
    const isChromeBrowser = /chrome/i.test(userAgent) && !/edg/i.test(userAgent);
    
    // Log browser detection details
    console.log("Browser detection:", { 
      userAgent,
      isSafariBrowser, 
      isChrome: isChromeBrowser,
      isFirefox: /firefox/i.test(userAgent)
    });
    
    setIsSafari(isSafariBrowser);
    setIsChrome(isChromeBrowser);
    
    // If using Chrome or Safari fallback, don't show loading spinner
    if (isSafariBrowser || isChromeBrowser) {
      setIsLoading(false);
    }
    
    // Validate URL format
    try {
      new URL(url);
      console.log("URL is valid format");
    } catch (e) {
      console.error("Invalid URL format:", url, e);
      setHasError(true);
      setErrorType('unknown');
    }
    
    // Pre-fetch the blob for potential blob URL fallback later
    const fetchBlob = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`URL fetch failed with status: ${response.status}`);
          return;
        }
        
        const blob = await response.blob();
        const blobUri = URL.createObjectURL(blob);
        console.log("Created blob URL for fallback:", blobUri);
        setBlobUrl(blobUri);
        
        // Clean up blob URL on unmount
        return () => {
          if (blobUri) {
            console.log("Cleaning up blob URL");
            URL.revokeObjectURL(blobUri);
          }
        };
      } catch (error) {
        console.error("Error creating blob URL:", error);
      }
    };
    
    // Start the fetch in the background
    fetchBlob();
    
    // Test URL access with fetch
    fetch(url, { 
      method: 'HEAD',
      // Add these headers to avoid CORS issues
      headers: {
        'Accept': 'application/pdf'
      }
    })
      .then(response => {
        console.log("URL fetch HEAD response:", response.status, response.ok);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      })
      .catch(error => {
        console.warn("URL fetch error:", error.message);
        // Don't set error here as the object tag might still work
      });
  }, [url]);

  // Handle load event
  const handleLoad = () => {
    console.log("PDF object loaded successfully:", url);
    setIsLoading(false);
  };

  // Handle error event
  const handleError = (e: React.SyntheticEvent<HTMLObjectElement, Event>) => {
    console.error("PDF object load error:", url, e);
    
    // Try blob URL as final fallback for PDF display
    if (!tryingBlob && blobUrl) {
      console.log("Trying blob URL fallback:", blobUrl);
      setTryingBlob(true);
      return;
    }
    
    // If we've tried everything, show error state
    setIsLoading(false);
    setHasError(true);
    setErrorType('load');
  };
  
  // Prevent click events from initiating downloads when clicking on the PDF thumbnail
  const handleClick = (e: React.MouseEvent) => {
    // Only prevent default for non-button/link clicks
    if (!(e.target as HTMLElement).closest('a')) {
      console.log("Preventing default click behavior");
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Detailed error message component based on error type
  const ErrorMessage = () => {
    if (errorType === 'cors') {
      return (
        <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          <span>Cross-origin access blocked</span>
        </div>
      );
    }
    return null;
  };

  // Fallback component that shows when object fails to load
  const FallbackComponent = () => (
    <div className="flex flex-col items-center justify-center p-4 text-center">
      <FileText className="h-12 w-12 text-primary mb-2" />
      <p className="text-xs text-muted-foreground">PDF Preview</p>
      <p className="text-xs text-muted-foreground mt-1">Click to open</p>
      <p className="text-xs text-red-500 mt-1">Error loading: {errorType || 'unknown'}</p>
      <ErrorMessage />
    </div>
  );

  // For Safari, use a different approach since iframe PDFs can be problematic
  const SafariFallback = () => {
    // Ensure loading state is false when rendering SafariFallback
    useEffect(() => {
      setIsLoading(false);
    }, []);
    
    return (
      <div className="flex flex-col items-center justify-center p-4 text-center">
        <FileText className="h-12 w-12 text-primary mb-2" />
        <p className="text-xs text-muted-foreground">PDF Document</p>
        <p className="text-xs text-muted-foreground mt-1">(Safari detected)</p>
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline mt-1"
        >
          Open PDF
        </a>
      </div>
    );
  };

  // Chrome-specific fallback with Google Docs viewer link and retry logic
  const ChromeFallback = () => {
    // Ensure loading state is false when rendering ChromeFallback
    useEffect(() => {
      setIsLoading(false);
    }, []);
    
    const [gdocsLoaded, setGdocsLoaded] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const [useFallback, setUseFallback] = useState(false);
    
    // Handle Google Docs iframe load
    const handleGdocsLoad = () => {
      console.log("Google Docs viewer loaded successfully");
      setGdocsLoaded(true);
    };
    
    // Handle Google Docs iframe error
    const handleGdocsError = () => {
      console.error("Google Docs viewer failed to load");
      if (retryCount < 2) {
        console.log(`Retrying Google Docs viewer (attempt ${retryCount + 1})`);
        setRetryCount(prev => prev + 1);
      } else {
        console.log("Max retries reached, using fallback view");
        setUseFallback(true);
      }
    };
    
    // Use direct object tag as fallback for Chrome when Google Docs fails
    if (useFallback) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full relative text-center group">
          <div className="absolute inset-0 flex items-center justify-center">
            <FileText className="h-24 w-24 text-primary/40" />
          </div>
          
          {/* Overlay with buttons - only visible on hover */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-200">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/90 rounded-md px-3 py-2 shadow-sm">
              <FileText className="h-6 w-6 text-primary mx-auto mb-1" />
              <p className="text-xs text-muted-foreground mb-2">PDF Document</p>
              <div className="flex gap-2">
                <a 
                  href={url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-md"
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log("Preview clicked for:", url);
                  }}
                >
                  Preview
                </a>
                <a 
                  href={url} 
                  download={`document-${new Date().getTime()}.pdf`}
                  className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log("Download clicked for:", url);
                    // Force download with fetch
                    fetch(url)
                      .then(resp => resp.blob())
                      .then(blob => {
                        const fileUrl = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = fileUrl;
                        a.download = `document-${new Date().getTime()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(fileUrl);
                        document.body.removeChild(a);
                      })
                      .catch(error => console.error("Download error:", error));
                  }}
                >
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // Force reload when retry count changes
    const iframeKey = `gdocs-viewer-${retryCount}`;
    
    return (
      <div className="flex flex-col items-center justify-center h-full w-full relative text-center group">
        {/* PDF Thumbnail using Google Docs viewer - shows first page */}
        <div className="absolute inset-0 w-full h-full">
          <iframe 
            key={iframeKey}
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
            className="w-full h-full object-contain"
            title="PDF Preview"
            onLoad={handleGdocsLoad}
            onError={handleGdocsError}
          />
        </div>
        
        {/* Loading state when retrying */}
        {retryCount > 0 && !gdocsLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70">
            <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin mb-2" />
            <p className="text-xs text-primary">Retrying preview...</p>
          </div>
        )}
        
        {/* Overlay with icon and buttons - only visible on hover */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-200">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/90 rounded-md px-3 py-2 shadow-sm">
            <FileText className="h-6 w-6 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground mb-2">PDF Document</p>
            <div className="flex gap-2">
              <a 
                href={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-md"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log("Preview clicked for:", url);
                }}
              >
                Preview
              </a>
              <a 
                href={url} 
                download={`document-${new Date().getTime()}.pdf`}
                className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  console.log("Download clicked for:", url);
                  // Force download with fetch
                  fetch(url)
                    .then(resp => resp.blob())
                    .then(blob => {
                      const fileUrl = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.style.display = 'none';
                      a.href = fileUrl;
                      a.download = `document-${new Date().getTime()}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(fileUrl);
                      document.body.removeChild(a);
                    })
                    .catch(error => console.error("Download error:", error));
                }}
              >
                Download
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className={cn(
        "flex items-center justify-center bg-muted/30 relative overflow-hidden w-full h-full",
        className
      )} 
      style={{ minWidth: width, minHeight: height }}
      onClick={handleClick}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
          <div className="h-5 w-5 border-t-2 border-primary rounded-full animate-spin" />
        </div>
      )}
      
      {hasError ? (
        <FallbackComponent />
      ) : isSafari ? (
        <SafariFallback />
      ) : isChrome ? (
        <ChromeFallback />
      ) : tryingBlob && blobUrl ? (
        // Try blob URL as final fallback approach
        <div className="w-full h-full relative">
          <iframe
            src={blobUrl}
            title="PDF Preview (Blob)"
            width={width}
            height={height}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            onLoad={handleLoad}
            onError={(e) => {
              console.error("Blob URL fallback failed:", blobUrl);
              // All approaches failed
              handleError(e as unknown as React.SyntheticEvent<HTMLObjectElement, Event>);
            }}
          />
        </div>
      ) : (
        <div className="w-full h-full relative">
          {/* Primary approach - try iframe first */}
          <iframe
            src={url}
            title="PDF Preview"
            width={width}
            height={height}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            onLoad={handleLoad}
            onError={(e) => {
              console.warn("PDF iframe failed, trying object tag fallback");
              // Don't set error yet - we'll try the object tag approach first
              setIsLoading(true); // Keep loading state while we try object tag
              
              // We'll let the object tag error handler set the final error state
              // instead of doing it here
            }}
          />
          
          {/* Fallback approach - object tag as secondary option */}
          {isLoading && (
            <object
              data={url}
              type="application/pdf"
              width={width}
              height={height}
              className="absolute inset-0 w-full h-full border-0"
              onLoad={() => {
                console.log("PDF object loaded successfully:", url);
                setIsLoading(false);
              }}
              onError={(e) => {
                console.error("Both PDF methods failed:", url);
                handleError(e as React.SyntheticEvent<HTMLObjectElement, Event>);
              }}
            >
              <FallbackComponent />
            </object>
          )}
        </div>
      )}
    </div>
  );
}

export default PdfThumbnailClient; 