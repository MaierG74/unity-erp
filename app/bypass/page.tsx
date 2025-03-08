'use client';

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function BypassPage() {
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clearState = async () => {
      try {
        // Clear local storage
        if (typeof window !== 'undefined') {
          // Clear every item from localStorage
          localStorage.clear();
          
          // Specifically target known auth items
          localStorage.removeItem('supabase.auth.token');
          localStorage.removeItem('unity-theme');
          
          // Clear session cookies (non-specific approach)
          document.cookie.split(';').forEach(c => {
            document.cookie = c.replace(/^ +/, '').replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`);
          });
          
          // Clear Supabase auth session
          await supabase.auth.signOut();
          setCleared(true);
        }
      } catch (err) {
        console.error('Error clearing state:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      }
    };

    clearState();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold mb-6">Authentication Bypass</h1>
      <div className="max-w-md w-full bg-card p-6 rounded-lg shadow-lg">
        {error ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p>Error clearing state: {error}</p>
            <p className="mt-2">Please try clearing your browser cookies manually.</p>
          </div>
        ) : (
          <p className="mb-4">
            {cleared 
              ? "Your local storage and authentication session have been cleared successfully."
              : "Clearing your local storage and authentication session..."}
          </p>
        )}
        
        <div className="space-y-4">
          <Button asChild className="w-full">
            <Link href="/">Go to Homepage</Link>
          </Button>
          
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Go to Login</Link>
          </Button>

          <div className="text-xs text-gray-500 mt-4">
            <p>If you continue to experience issues:</p>
            <ol className="list-decimal list-inside mt-1">
              <li>Open your browser&apos;s developer tools (F12)</li>
              <li>Go to Application tab &gt; Storage &gt; Clear Site Data</li>
              <li>Try using an incognito/private window</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
} 