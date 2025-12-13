'use client';

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/common/auth-provider";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { BarChart3, Users, Package, ClipboardList, Truck, ArrowRight } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { resolvedTheme } = useTheme();

  const isDarkMode = resolvedTheme === 'dark';

  const features = [
    { icon: BarChart3, title: 'Analytics & Reports', description: 'Real-time insights and comprehensive reporting' },
    { icon: Users, title: 'Staff Management', description: 'Time tracking, payroll, and scheduling' },
    { icon: Package, title: 'Inventory Control', description: 'Track stock levels and manage components' },
    { icon: ClipboardList, title: 'Order Management', description: 'Quotes, orders, and customer tracking' },
    { icon: Truck, title: 'Purchasing', description: 'Supplier management and purchase orders' },
  ];

  return (
    <div className={`fixed inset-0 w-screen h-screen overflow-auto ${isDarkMode ? 'bg-[#0a0a0f]' : 'bg-gradient-to-br from-stone-100 via-orange-50/30 to-stone-100'}`}>
      {/* Decorative gradient orbs - larger and more prominent in dark mode */}
      <div className={`absolute top-0 left-0 w-[600px] h-[600px] ${isDarkMode ? 'bg-orange-600/20' : 'bg-orange-400/20'} rounded-full blur-[120px] pointer-events-none -translate-x-1/2 -translate-y-1/2`} />
      <div className={`absolute bottom-0 right-0 w-[500px] h-[500px] ${isDarkMode ? 'bg-orange-500/15' : 'bg-orange-300/20'} rounded-full blur-[100px] pointer-events-none translate-x-1/3 translate-y-1/3`} />
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] ${isDarkMode ? 'bg-orange-600/10' : 'bg-orange-200/20'} rounded-full blur-[150px] pointer-events-none`} />

      <div className="relative z-10 w-full min-h-full flex flex-col">
        {/* Hero Section */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 md:py-20">
          <div className="w-full max-w-6xl mx-auto">
            <div className="text-center mb-16">
              {/* Title */}
              <div className="relative inline-block mb-6">
                <h1
                  className={`${isDarkMode ? 'text-white' : 'text-[#F26B3A]'} text-5xl md:text-6xl lg:text-7xl font-extralight tracking-[0.2em] uppercase`}
                >
                  Unity ERP
                </h1>
              </div>

              {/* Tagline */}
              <p className={`text-base md:text-lg font-light tracking-[0.15em] uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} max-w-2xl mx-auto mb-12`}>
                Enterprise Resource Planning
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                {!loading && !user ? (
                  <>
                    <Button
                      variant="default"
                      size="lg"
                      className="px-8 py-6 text-lg bg-[#F26B3A] hover:bg-[#E25A29] text-white shadow-lg shadow-orange-500/20 transition-all duration-300 hover:shadow-orange-500/30 hover:scale-[1.02] group"
                      onClick={() => router.push('/login')}
                    >
                      Get Started
                      <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className={`px-8 py-6 text-lg ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'} transition-all duration-300`}
                      onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      Learn More
                    </Button>
                  </>
                ) : !loading && user ? (
                  <Link href="/dashboard">
                    <Button
                      variant="default"
                      size="lg"
                      className="px-8 py-6 text-lg bg-[#F26B3A] hover:bg-[#E25A29] text-white shadow-lg shadow-orange-500/20 transition-all duration-300 hover:shadow-orange-500/30 hover:scale-[1.02] group"
                    >
                      Go to Dashboard
                      <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
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

            {/* Features Section */}
            <div id="features" className="mt-8">
              <h3 className={`text-center text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} mb-8`}>
                Everything you need to manage your business
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {features.map((feature, index) => (
                  <div
                    key={index}
                    className={`group p-6 rounded-xl ${
                      isDarkMode
                        ? 'bg-gray-900/50 border border-gray-800 hover:border-orange-500/50 hover:bg-gray-900/80'
                        : 'bg-white/60 border border-gray-200 hover:border-orange-300 hover:bg-white/80'
                    } backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg cursor-default`}
                  >
                    <div className={`w-12 h-12 rounded-lg ${isDarkMode ? 'bg-orange-500/10' : 'bg-orange-100'} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <feature.icon className={`w-6 h-6 ${isDarkMode ? 'text-orange-400' : 'text-[#F26B3A]'}`} />
                    </div>
                    <h4 className={`font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {feature.title}
                    </h4>
                    <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className={`py-6 text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} text-sm`}>
          <p>Enterprise Resource Planning System</p>
        </footer>
      </div>
    </div>
  );
}
