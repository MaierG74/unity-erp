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
    <div className={`fixed inset-0 w-screen h-screen ${isDarkMode ? 'bg-black' : 'bg-stone-100'}`}>
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center space-y-16">
          <div className="relative w-full">
            <h1 className={`${isDarkMode ? 'text-white' : 'text-[#F26B3A]'} text-7xl md:text-8xl lg:text-9xl font-bold text-center`} style={{ textShadow: '2px 4px 8px rgba(0,0,0,0.1)' }}>
              Unity ERP
            </h1>
            
            {/* Sparkles effect */}
            <div className="w-full max-w-[40rem] h-24 relative mx-auto mt-4">
              {/* Gradients */}
              <div className={`absolute inset-x-20 top-0 bg-gradient-to-r from-transparent ${isDarkMode ? 'via-white' : 'via-[#F26B3A]'} to-transparent h-[2px] w-3/4 blur-sm mx-auto opacity-50`} />
              <div className={`absolute inset-x-20 top-0 bg-gradient-to-r from-transparent ${isDarkMode ? 'via-white' : 'via-[#F26B3A]'} to-transparent h-px w-3/4 mx-auto opacity-30`} />
              <div className={`absolute inset-x-60 top-0 bg-gradient-to-r from-transparent ${isDarkMode ? 'via-white' : 'via-[#F26B3A]'} to-transparent h-[5px] w-1/4 blur-sm mx-auto opacity-50`} />
              <div className={`absolute inset-x-60 top-0 bg-gradient-to-r from-transparent ${isDarkMode ? 'via-white' : 'via-[#F26B3A]'} to-transparent h-px w-1/4 mx-auto opacity-30`} />

              {/* Core component */}
              <SparklesCore
                background="transparent"
                minSize={0.4}
                maxSize={1}
                particleDensity={1200}
                className="w-full h-full"
                particleColor={isDarkMode ? "#ffffff" : "#F26B3A"}
              />

              {/* Radial Gradient */}
              <div className={`absolute inset-0 w-full h-full ${isDarkMode ? 'bg-black' : 'bg-stone-100'} [mask-image:radial-gradient(350px_200px_at_top,transparent_20%,white)]`}></div>
            </div>
          </div>

          <div className="space-y-12">
            <h2 className={`text-2xl font-medium ${isDarkMode ? 'text-white' : 'text-gray-800'} text-center`}>
              Your modern enterprise resource planning solution
            </h2>
            
            <div className="flex justify-center">
              {!loading && !user ? (
                <Button 
                  variant="default" 
                  size="lg" 
                  className="px-8 py-6 text-lg bg-[#F26B3A] hover:bg-[#E25A29] text-white"
                  onClick={() => router.push('/login')}
                >
                  Login
                </Button>
              ) : !loading && user ? (
                <Link href="/dashboard">
                  <Button 
                    variant="default" 
                    size="lg" 
                    className="px-8 py-6 text-lg bg-[#F26B3A] hover:bg-[#E25A29] text-white"
                  >
                    Dashboard
                  </Button>
                </Link>
              ) : (
                <Button 
                  variant="default" 
                  size="lg" 
                  disabled 
                  className="px-8 py-6 text-lg bg-[#F26B3A] hover:bg-[#E25A29] text-white"
                >
                  Loading...
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
