'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function TestDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const id = params.id;

  const handleBack = () => {
    console.log('Back button clicked');
    router.push('/test-router');
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">Test Detail Page</h1>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Item ID: {id}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            This is a test detail page to verify dynamic routing is working correctly.
            The ID parameter from the URL is: <strong>{id}</strong>
          </p>
          
          <Button 
            className="mt-4"
            onClick={handleBack}
          >
            Go Back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
} 