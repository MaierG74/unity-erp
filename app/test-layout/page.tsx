'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TestLayoutPage() {
  const [showSidebar, setShowSidebar] = useState(true);
  
  return (
    <div className="min-h-screen bg-background">
      {/* Force the navbar to be visible */}
      <Navbar />
      
      {/* Toggle sidebar */}
      <div className="fixed top-20 right-4 z-50">
        <Button 
          onClick={() => setShowSidebar(!showSidebar)}
          variant="outline"
        >
          {showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
        </Button>
      </div>
      
      {/* Force the sidebar to be visible */}
      {showSidebar && <Sidebar />}
      
      {/* Main content with proper spacing */}
      <main className={`pt-16 ${showSidebar ? 'pl-64' : ''} transition-all duration-300`}>
        <div className="container py-8">
          <Card>
            <CardHeader>
              <CardTitle>Layout Test Page</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4">
                This page bypasses authentication to test the layout structure directly.
                If you can see the sidebar on the left and this content is properly aligned,
                then the layout components are working correctly.
              </p>
              
              <div className="p-4 bg-blue-100 text-blue-800 rounded-md mb-4">
                <strong>Styling Analysis:</strong>
                <ul className="list-disc ml-4 mt-2">
                  <li>Sidebar should be fixed to the left side of the screen</li>
                  <li>Content should be pushed to the right by the sidebar width (256px)</li>
                  <li>Navbar should be fixed to the top of the screen</li>
                  <li>This content should start below the navbar with proper padding</li>
                </ul>
              </div>
              
              <p>
                If the layout looks correct here but not in other parts of the application,
                the issue is likely related to authentication - the user state isn't being detected
                correctly, causing the sidebar not to render.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
} 