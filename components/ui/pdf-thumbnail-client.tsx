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
  const [initialized, setInitialized] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  
  // Use cache busting for URLs
  const cacheBustUrl = url.includes('?') 
    ? `${url}&_cb=${Date.now()}` 
    : `${url}?_cb=${Date.now()}`;
  
  // Force initialization on mount and when URL changes
  useEffect(() => {
    // Reset states
    setIsLoading(true);
    setHasError(false);
    setErrorType(null);
    setTryingBlob(false);
    setBlobUrl(null);
    setShowFallback(false);
    
    // Log component initialization
    console.log(`PdfThumbnailClient initializing: ${url}`);
    
    // Show fallback after a timeout if still loading
    const fallbackTimer = setTimeout(() => {
      if (isLoading) {
        console.log("PDF loading timeout reached, showing fallback");
        setShowFallback(true);
      }
    }, 5000);
    
    // Small delay to ensure component is fully mounted before loading
    const timer = setTimeout(() => {
      setInitialized(true);
    }, 100); // Brief delay to ensure DOM is ready
    
    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      // Clean up blob URL on unmount if created
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [url]);
  
  // Enhanced debugging and fallback on mount with improved prefetching
  useEffect(() => {
    if (!initialized) return;
    
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
      return; // Exit early if URL is invalid
    }
    
    // Improved prefetching strategy with retries
    const fetchWithRetries = async (attempts = 3) => {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          console.log(`Fetching PDF blob: Attempt ${attempt}/${attempts}`);
          
          // Use a longer timeout for fetch operations
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          const response = await fetch(url, { 
            signal: controller.signal,
            cache: 'force-cache', // Try to use cached version if available
            headers: {
              'Accept': 'application/pdf'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            console.warn(`URL fetch failed with status: ${response.status}`);
            if (attempt === attempts) {
              // Only set error on last attempt
              setErrorType('load');
              return null;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          const blob = await response.blob();
          if (blob.size === 0) {
            console.error("Received empty blob");
            if (attempt === attempts) {
              setErrorType('load');
              return null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          const blobUri = URL.createObjectURL(blob);
          console.log("Created blob URL for PDF:", blobUri);
          return blobUri;
        } catch (error) {
          console.error(`Fetch attempt ${attempt} failed:`, error);
          if (attempt === attempts) {
            setErrorType(error.name === 'AbortError' ? 'load' : 'cors');
            return null;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      return null;
    };
    
    // Start the fetch with retries
    fetchWithRetries().then(blobUri => {
      if (blobUri) {
        setBlobUrl(blobUri);
        // If we're showing a loading state, use the blob immediately as fallback
        if (isLoading) {
          setTryingBlob(true);
        }
      } else {
        console.error("All fetch attempts failed");
        // Only set error if we've already tried loading via iframe/object
        if (isLoading) {
          setHasError(true);
        }
      }
    });
    
    // Test URL access with fetch HEAD request for metadata
    fetch(url, { 
      method: 'HEAD',
      headers: {
        'Accept': 'application/pdf'
      }
    })
      .then(response => {
        console.log("URL HEAD response:", response.status, response.ok, {
          'Content-Type': response.headers.get('content-type'),
          'Content-Length': response.headers.get('content-length')
        });
      })
      .catch(error => {
        console.warn("URL HEAD request error:", error.message);
      });
  }, [url, initialized, isLoading]);

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
      
      {/* Refresh button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          console.log("Manual PDF refresh triggered");
          
          // Reset all states to trigger a reload of the component
          setHasError(false);
          setErrorType(null);
          setTryingBlob(false);
          setBlobUrl(null);
          setIsLoading(true);
          setInitialized(false);
          setShowFallback(false);
          
          // Force re-initialization after a brief delay
          setTimeout(() => {
            setInitialized(true);
          }, 100);
        }}
        className="mt-2 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 transition-colors flex items-center gap-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
        Retry
      </button>
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
    const [showIframe, setShowIframe] = useState(false);
    
    // Initialize on mount with more aggressive timeout handling
    useEffect(() => {
      // Short delay before showing iframe to ensure DOM is ready
      setTimeout(() => {
        setShowIframe(true);
      }, 200);
      
      // Try direct loading first for 3 seconds
      const directLoadTimeout = setTimeout(() => {
        if (!gdocsLoaded) {
          console.log("First attempt timeout - trying Google Docs viewer");
          // Force a retry if not loaded in 3 seconds
          setRetryCount(prev => prev + 1);
        }
      }, 3000);
      
      // Safety timeout after 8 seconds - switch to fallback
      const fallbackTimeout = setTimeout(() => {
        if (!gdocsLoaded) {
          console.log("Google Docs viewer timeout - switching to fallback");
          setUseFallback(true);
        }
      }, 8000);
      
      return () => {
        clearTimeout(directLoadTimeout);
        clearTimeout(fallbackTimeout);
      };
    }, []);
    
    // Handle Google Docs iframe load
    const handleGdocsLoad = () => {
      console.log("Google Docs viewer loaded successfully");
      setGdocsLoaded(true);
    };
    
    // Handle Google Docs iframe error with more aggressive retry
    const handleGdocsError = () => {
      console.error("Google Docs viewer failed to load");
      if (retryCount < 3) { // Increase max retries to 3
        console.log(`Retrying Google Docs viewer (attempt ${retryCount + 1}/3)`);
        // Hide iframe momentarily to force a reload
        setShowIframe(false);
        
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          setShowIframe(true);
        }, 100);
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log("Manual PDF refresh triggered");
                    
                    // Reset all states to trigger a reload of the component
                    setHasError(false);
                    setErrorType(null);
                    setTryingBlob(false);
                    setBlobUrl(null);
                    setIsLoading(true);
                    setInitialized(false);
                    setShowFallback(false);
                    
                    // Force re-initialization after a brief delay
                    setTimeout(() => {
                      setInitialized(true);
                    }, 100);
                  }}
                  className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                  Refresh
                </button>
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
          {showIframe && (
            <iframe 
              key={iframeKey}
              src={`https://docs.google.com/viewer?url=${encodeURIComponent(cacheBustUrl)}&embedded=true`}
              className="w-full h-full object-contain"
              title="PDF Preview"
              onLoad={handleGdocsLoad}
              onError={handleGdocsError}
            />
          )}
        </div>
        
        {/* Loading state when retrying */}
        {(retryCount > 0 && !gdocsLoaded) && (
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
                href={`https://docs.google.com/viewer?url=${encodeURIComponent(cacheBustUrl)}&embedded=true`}
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
                href={cacheBustUrl} 
                download={`document-${new Date().getTime()}.pdf`}
                className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  console.log("Download clicked for:", url);
                  // Force download with fetch
                  fetch(cacheBustUrl)
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log("Manual PDF refresh triggered");
                  
                  // Reset all states to trigger a reload of the component
                  setHasError(false);
                  setErrorType(null);
                  setTryingBlob(false);
                  setBlobUrl(null);
                  setIsLoading(true);
                  setInitialized(false);
                  setShowFallback(false);
                  
                  // Force re-initialization after a brief delay
                  setTimeout(() => {
                    setInitialized(true);
                  }, 100);
                }}
                className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
                Refresh
              </button>
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
          <span className="ml-2 text-xs text-muted-foreground">Loading PDF...</span>
        </div>
      )}
      
      {/* Fallback for still loading states */}
      {showFallback && isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 z-5">
          <FileText className="h-12 w-12 text-primary/40 mb-2" />
          <p className="text-xs text-muted-foreground">PDF Loading...</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              console.log("Manual PDF refresh triggered");
              
              // Reset all states to trigger a reload of the component
              setHasError(false);
              setErrorType(null);
              setTryingBlob(false);
              setBlobUrl(null);
              setIsLoading(true);
              setInitialized(false);
              setShowFallback(false);
              
              // Force re-initialization after a brief delay
              setTimeout(() => {
                setInitialized(true);
              }, 100);
            }}
            className="mt-2 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            Retry
          </button>
        </div>
      )}
      
      {hasError ? (
        <FallbackComponent />
      ) : isSafari ? (
        <SafariFallback />
      ) : isChrome ? (
        <ChromeFallback />
      ) : tryingBlob && blobUrl ? (
        // Use blob URL as fallback approach with improved error handling
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
              // Try direct rendering as image if blob URL fails
              handleError(e as unknown as React.SyntheticEvent<HTMLObjectElement, Event>);
            }}
          />
          
          {/* Add hover overlay with buttons even for blob version */}
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log("Manual PDF refresh triggered");
                    
                    // Reset all states to trigger a reload of the component
                    setHasError(false);
                    setErrorType(null);
                    setTryingBlob(false);
                    setBlobUrl(null);
                    setIsLoading(true);
                    setInitialized(false);
                    setShowFallback(false);
                    
                    // Force re-initialization after a brief delay
                    setTimeout(() => {
                      setInitialized(true);
                    }, 100);
                  }}
                  className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full relative group">
          {/* Primary approach - try iframe first */}
          <iframe
            src={cacheBustUrl}
            title="PDF Preview"
            width={width}
            height={height}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            onLoad={handleLoad}
            onError={(e) => {
              console.warn("PDF iframe failed, trying blob URL if available or object tag fallback");
              // If we already have a blob URL, use it immediately
              if (blobUrl) {
                setTryingBlob(true);
                setIsLoading(false);
              } else {
                // Otherwise keep loading state for object tag
                setIsLoading(true);
              }
            }}
          />
          
          {/* Add hover overlay with buttons for standard view */}
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log("Manual PDF refresh triggered");
                    
                    // Reset all states to trigger a reload of the component
                    setHasError(false);
                    setErrorType(null);
                    setTryingBlob(false);
                    setBlobUrl(null);
                    setIsLoading(true);
                    setInitialized(false);
                    setShowFallback(false);
                    
                    // Force re-initialization after a brief delay
                    setTimeout(() => {
                      setInitialized(true);
                    }, 100);
                  }}
                  className="text-xs border border-primary text-primary hover:bg-primary/10 px-3 py-1.5 rounded-md flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>
          </div>
          
          {/* Fallback approach - object tag as secondary option */}
          {isLoading && !blobUrl && (
            <object
              data={cacheBustUrl}
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