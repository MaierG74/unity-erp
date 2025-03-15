'use client';

import { SparklesCore } from "@/components/ui/sparkles";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { resolvedTheme } = useTheme();
  
  const isDarkMode = resolvedTheme === 'dark';

  return (
    <div className={`h-screen w-screen ${isDarkMode ? 'bg-black' : 'bg-stone-100'} fixed inset-0 flex items-center justify-center`}>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl text-center px-4">
        <h1 className={`md:text-7xl text-4xl lg:text-9xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-primary'} mb-0`}>
          Unity ERP
        </h1>
        
        {/* Exact implementation from 21st.dev SparklesPreview */}
        <div className="w-full max-w-[40rem] h-24 relative mx-auto">
          {/* Gradients */}
          <div className="absolute inset-x-20 top-0 bg-gradient-to-r from-transparent via-black to-transparent h-[2px] w-3/4 blur-sm mx-auto left-0 right-0" />
          <div className="absolute inset-x-20 top-0 bg-gradient-to-r from-transparent via-black to-transparent h-px w-3/4 mx-auto left-0 right-0" />
          <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent via-black to-transparent h-[5px] w-1/4 blur-sm mx-auto left-0 right-0" />
          <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent via-black to-transparent h-px w-1/4 mx-auto left-0 right-0" />

          {/* Core component */}
          <SparklesCore
            background="transparent"
            minSize={0.4}
            maxSize={1}
            particleDensity={1200}
            className="w-full h-full"
            particleColor={isDarkMode ? "#d6d3d1" : "#1f1f1f"}
          />

          {/* Radial Gradient to prevent sharp edges */}
          <div className={`absolute inset-0 w-full h-full ${isDarkMode ? 'bg-black' : 'bg-stone-100'} [mask-image:radial-gradient(350px_200px_at_top,transparent_20%,white)]`}></div>
        </div>
        
        <div className="text-center mt-4 w-full">
          <h2 className={isDarkMode ? "text-white text-2xl font-medium" : "text-foreground text-2xl font-medium"}>
            Your modern enterprise resource planning solution
          </h2>
        </div>
        
        <div className="flex flex-row gap-4 mt-8 justify-center">
          {!loading && !user ? (
            <Link href="/login">
              <Button variant="default" size="lg" className="px-8 py-6 text-lg">
                Login
              </Button>
            </Link>
          ) : !loading && user ? (
            <Link href="/dashboard">
              <Button variant="default" size="lg" className="px-8 py-6 text-lg">
                Dashboard
              </Button>
            </Link>
          ) : (
            <Button variant="default" size="lg" disabled className="px-8 py-6 text-lg">
              Loading...
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
