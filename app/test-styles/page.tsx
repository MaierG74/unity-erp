'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';

export default function TestStylesPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  
  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
    document.documentElement.classList.toggle('dark');
  };
  
  return (
    <div className={`min-h-screen p-8 ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">Styling Test Page</h1>
          <Button onClick={toggleTheme}>
            Toggle Theme ({theme})
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic styling */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Styles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground">This text should be using the foreground color.</p>
              <div className="p-4 bg-background border rounded-md">
                This div should have the background color and a border.
              </div>
              <div className="p-4 bg-primary text-primary-foreground rounded-md">
                This div should have the primary color as background.
              </div>
              <div className="p-4 bg-secondary text-secondary-foreground rounded-md">
                This div should have the secondary color as background.
              </div>
            </CardContent>
          </Card>
          
          {/* Component styling */}
          <Card>
            <CardHeader>
              <CardTitle>Component Styles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="default" className="w-full">Default Button</Button>
              <Button variant="outline" className="w-full">Outline Button</Button>
              <Button variant="destructive" className="w-full">Destructive Button</Button>
              <Button variant="ghost" className="w-full">Ghost Button</Button>
              <div className="p-4 border rounded-md">
                <p className="text-muted-foreground">This should be muted text.</p>
              </div>
            </CardContent>
          </Card>
          
          {/* Custom component styling */}
          <Card>
            <CardHeader>
              <CardTitle>Custom Component Styles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="card">
                This should have card styling from globals.css
              </div>
              <div className="input-field w-full">
                This should look like an input field
              </div>
              <button className="button-primary w-full">
                This should have button-primary styling
              </button>
              <a href="#" className="sidebar-link">
                This should have sidebar-link styling
              </a>
              <a href="#" className="sidebar-link active">
                This should have active sidebar-link styling
              </a>
            </CardContent>
          </Card>
          
          {/* Utility colors */}
          <Card>
            <CardHeader>
              <CardTitle>Utility Colors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-border">Border</div>
                <div className="p-2 bg-input">Input</div>
                <div className="p-2 bg-ring">Ring</div>
                <div className="p-2 bg-accent">Accent</div>
                <div className="p-2 bg-accent-foreground text-white">Accent Foreground</div>
                <div className="p-2 bg-destructive text-white">Destructive</div>
                <div className="p-2 bg-destructive-foreground">Destructive Foreground</div>
                <div className="p-2 bg-muted">Muted</div>
                <div className="p-2 bg-muted-foreground text-white">Muted Foreground</div>
                <div className="p-2 bg-popover">Popover</div>
                <div className="p-2 bg-popover-foreground">Popover Foreground</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} 