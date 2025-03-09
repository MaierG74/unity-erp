'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DebugPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      setAuthState(data);
      console.log("Current auth state:", data);
      if (error) {
        setError(error.message);
      }
    } catch (err: any) {
      setError(err.message);
      console.error("Auth check error:", err);
    }
  };

  const forceLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try to sign in with a test account
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      });
      
      if (error) {
        // If login fails, try to create the account
        console.log("Login failed, trying to create account:", error);
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: 'test@example.com',
          password: 'password123',
        });
        
        if (signUpError) {
          console.error("Failed to create test account:", signUpError);
          setError(signUpError.message);
        } else {
          console.log("Created test account:", signUpData);
          // Try logging in again
          const { error: loginError } = await supabase.auth.signInWithPassword({
            email: 'test@example.com',
            password: 'password123',
          });
          
          if (loginError) {
            setError(loginError.message);
          } else {
            router.push('/dashboard');
          }
        }
      } else {
        console.log("Logged in successfully:", data);
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.message);
      console.error("Auth error:", err);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setAuthState(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-10">
      <Card>
        <CardHeader>
          <CardTitle>Debug Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Button onClick={checkAuth}>Check Auth State</Button>
              <Button onClick={forceLogin} disabled={loading}>
                {loading ? "Processing..." : "Force Login (test@example.com)"}
              </Button>
              <Button onClick={logout} variant="destructive">
                Logout
              </Button>
              <Button onClick={() => router.push('/dashboard')} variant="outline">
                Go to Dashboard
              </Button>
            </div>
            
            {error && (
              <div className="p-4 bg-red-100 text-red-800 rounded-md">
                Error: {error}
              </div>
            )}
            
            <div className="mt-4">
              <h3 className="text-lg font-medium mb-2">Current Auth State:</h3>
              <pre className="bg-muted p-4 rounded-md overflow-auto max-h-96 text-xs">
                {JSON.stringify(authState, null, 2)}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 