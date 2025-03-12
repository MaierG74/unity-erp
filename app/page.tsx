'use client';

import { SparklesCore } from "@/components/ui/sparkles";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center overflow-hidden">
      <div className="flex flex-col items-center justify-center">
        <h1 className="md:text-7xl text-3xl lg:text-9xl font-bold text-center text-white relative z-20">
          Unity ERP
        </h1>
        <div className="w-[40rem] h-40 relative">
          {/* Gradients */}
          <div className="absolute inset-x-20 top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-[2px] w-3/4 blur-sm" />
          <div className="absolute inset-x-20 top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-px w-3/4" />
          <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-[5px] w-1/4 blur-sm" />
          <div className="absolute inset-x-60 top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-px w-1/4" />

          {/* Core component */}
          <SparklesCore
            background="transparent"
            minSize={0.4}
            maxSize={1}
            particleDensity={1200}
            className="w-full h-full"
            particleColor="#FFFFFF"
          />

          {/* Radial Gradient to prevent sharp edges */}
          <div className="absolute inset-0 w-full h-full bg-black [mask-image:radial-gradient(350px_200px_at_top,transparent_20%,white)]"></div>
        </div>
        
        <div className="text-center relative z-20 mt-4">
          <h2 className="text-white text-2xl">
            Your modern enterprise resource planning solution
          </h2>
        </div>
        
        <div className="flex flex-row gap-2 mt-8 relative z-20">
          {!loading && !user ? (
            <Link href="/login">
              <Button variant="default" size="lg">
                Login
              </Button>
            </Link>
          ) : !loading && user ? (
            <Link href="/dashboard">
              <Button variant="default" size="lg">
                Dashboard
              </Button>
            </Link>
          ) : (
            <Button variant="default" size="lg" disabled>
              Loading...
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
