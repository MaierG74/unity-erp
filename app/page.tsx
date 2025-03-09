'use client';

import { SparklesCore } from "@/components/ui/sparkles";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<any>(null);

  const checkAuth = async () => {
    const { data } = await supabase.auth.getSession();
    setAuthState(data);
    console.log("Current auth state:", data);
  };

  const forceLogin = async () => {
    setLoading(true);
    try {
      // Try to sign in with a test account or create one if needed
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      });
      
      if (error) {
        // If login fails, try to create the account
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: 'test@example.com',
          password: 'password123',
        });
        
        if (signUpError) {
          console.error("Failed to create test account:", signUpError);
        } else {
          console.log("Created test account:", signUpData);
        }
      } else {
        console.log("Logged in successfully:", data);
        router.push('/dashboard');
      }
    } catch (err) {
      console.error("Auth error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[40rem] w-full bg-black flex flex-col items-center justify-center overflow-hidden rounded-md">
      <div className="w-full absolute inset-0 h-screen">
        <SparklesCore
          id="tsparticlesfullpage"
          background="transparent"
          minSize={0.6}
          maxSize={1.4}
          particleDensity={100}
          className="w-full h-full"
          particleColor="#FFFFFF"
        />
      </div>
      <h1 className="md:text-7xl text-3xl lg:text-9xl font-bold text-center text-white relative z-20">
        Unity ERP
      </h1>
      <div className="text-center mt-4 relative z-20">
        <h2 className="text-white text-2xl">
          Your modern enterprise resource planning solution
        </h2>
      </div>
      <div className="flex flex-row gap-2 mt-8 relative z-20">
        <Link href="/login">
          <Button variant="default" size="lg">
            Login
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="outline" size="lg">
            Dashboard
          </Button>
        </Link>
      </div>

      <div className="mt-8 p-4 border border-white/20 rounded-lg relative z-20 bg-black/50 max-w-md w-full mx-auto">
        <h2 className="text-lg font-semibold mb-2 text-white">Debug Tools</h2>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={checkAuth}>
            Check Auth State
          </Button>
          <Button variant="outline" onClick={forceLogin} disabled={loading}>
            {loading ? "Attempting Login..." : "Force Login (Test Account)"}
          </Button>
          {authState && (
            <pre className="bg-black/50 p-2 rounded text-xs mt-2 overflow-auto max-h-40 text-white">
              {JSON.stringify(authState, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
