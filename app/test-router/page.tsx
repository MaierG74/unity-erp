'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function TestRouterPage() {
  const router = useRouter();
  const [clicked, setClicked] = useState<string | null>(null);

  const handleNavigate = (path: string) => {
    console.log('Navigate button clicked for path:', path);
    setClicked(path);
    router.push(path);
  };

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-2xl font-bold">Router Test Page</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Navigation Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            This page tests if the router navigation is working correctly.
            Click on the buttons below to navigate to different pages.
          </p>
          
          <p>
            {clicked ? `You clicked to navigate to: ${clicked}` : 'No button clicked yet'}
          </p>
          
          <div className="flex space-x-4">
            <Button onClick={() => handleNavigate('/products')}>
              Go to Products (router.push)
            </Button>
            
            <Button onClick={() => handleNavigate('/dashboard')}>
              Go to Dashboard (router.push)
            </Button>
          </div>
          
          <div className="flex space-x-4 mt-4">
            <Link href="/products">
              <Button>
                Go to Products (Link)
              </Button>
            </Link>
            
            <Link href="/dashboard">
              <Button>
                Go to Dashboard (Link)
              </Button>
            </Link>
          </div>
          
          <div className="flex space-x-4 mt-4">
            <Link href="/test-router/123">
              <Button>
                Go to Test Detail Page (Link)
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 