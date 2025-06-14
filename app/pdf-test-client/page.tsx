'use client';

import { useState } from 'react';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function PdfTestPage() {
  const [pdfUrl, setPdfUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');

  // Sample PDF URLs for testing
  const samplePdfs = [
    'https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf',
    'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    'https://www.orimi.com/pdf-test.pdf'
  ];

  return (
    <div className="container mx-auto py-10 space-y-6">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/orders" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-3xl font-bold">PDF Thumbnail Test (Client-side)</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PDF URL Input</CardTitle>
          <CardDescription>
            Enter a URL to a PDF file to test the thumbnail generation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex w-full max-w-lg items-end gap-2">
            <div className="grid w-full gap-1.5">
              <Label htmlFor="pdfUrl">PDF URL</Label>
              <Input 
                id="pdfUrl" 
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://example.com/document.pdf"
              />
            </div>
            <Button onClick={() => setPdfUrl(inputUrl)}>Load PDF</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your PDF</CardTitle>
            <CardDescription>
              {pdfUrl ? 'PDF thumbnail from your URL' : 'Enter a URL to load a PDF'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center min-h-[300px]">
            {pdfUrl ? (
              <PdfThumbnailClient url={pdfUrl} width={200} height={280} />
            ) : (
              <div className="flex items-center justify-center h-full w-full text-muted-foreground">
                No PDF loaded
              </div>
            )}
          </CardContent>
          <CardFooter className="text-sm text-muted-foreground truncate">
            {pdfUrl || 'No URL specified'}
          </CardFooter>
        </Card>

        {samplePdfs.map((url, index) => (
          <Card key={index}>
            <CardHeader>
              <CardTitle>Sample PDF {index + 1}</CardTitle>
              <CardDescription>Testing with a sample PDF</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center min-h-[300px]">
              <PdfThumbnailClient url={url} width={200} height={280} />
            </CardContent>
            <CardFooter className="text-sm text-muted-foreground truncate">
              {url}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
} 