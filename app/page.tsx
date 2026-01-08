'use client';

/**
 * Landing Page - Unity ERP
 *
 * Modernized design with:
 * - Animated background paths from 21st.dev
 * - Cool/neutral color palette (teal/slate instead of orange)
 * - Inter font (already configured in layout)
 * - Spacious hero section with animated title
 * - Refined feature cards with hover effects
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/common/auth-provider";
import { useRouter } from "next/navigation";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { BarChart3, Users, Package, ClipboardList, Truck, ArrowRight } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Feature cards data - describes key modules
  const features = [
    { icon: BarChart3, title: 'Analytics & Reports', description: 'Real-time insights and comprehensive reporting' },
    { icon: Users, title: 'Staff Management', description: 'Time tracking, payroll, and scheduling' },
    { icon: Package, title: 'Inventory Control', description: 'Track stock levels and manage components' },
    { icon: ClipboardList, title: 'Order Management', description: 'Quotes, orders, and customer tracking' },
    { icon: Truck, title: 'Purchasing', description: 'Supplier management and purchase orders' },
  ];

  // Title animation - split into words then letters for staggered effect
  const title = "UNITY ERP";
  const words = title.split(" ");

  return (
    <BackgroundPaths className="fixed inset-0 w-screen h-screen overflow-auto">
      <div className="w-full min-h-full flex flex-col">
        {/* Hero Section - increased padding for spaciousness */}
        <div className="flex-1 flex items-center justify-center px-6 py-20 md:py-28">
          <div className="w-full max-w-6xl mx-auto">
            <div className="text-center mb-16">
              {/* Animated Title - using motion for staggered letter reveal */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
                className="mb-6"
              >
                <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter">
                  {words.map((word, wordIndex) => (
                    <span key={wordIndex} className="inline-block mr-4 last:mr-0">
                      {word.split("").map((letter, letterIndex) => (
                        <motion.span
                          key={`${wordIndex}-${letterIndex}`}
                          initial={{ y: 50, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{
                            delay: wordIndex * 0.1 + letterIndex * 0.04,
                            type: "spring",
                            stiffness: 150,
                            damping: 25,
                          }}
                          className="inline-block text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-white/80"
                        >
                          {letter}
                        </motion.span>
                      ))}
                    </span>
                  ))}
                </h1>
              </motion.div>

              {/* Tagline - dark charcoal for contrast, light weight */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="text-base md:text-lg font-light tracking-[0.15em] uppercase text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-12"
              >
                Enterprise Resource Planning
              </motion.p>

              {/* CTA Buttons - teal/blue solid color, 8px radius */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.8 }}
                className="flex flex-col sm:flex-row gap-4 justify-center items-center"
              >
                {!loading && !user ? (
                  <>
                    {/* Primary CTA - Teal solid color with hover darkening */}
                    <div className="inline-block group relative bg-gradient-to-b from-black/10 to-white/10 dark:from-white/10 dark:to-black/10 p-px rounded-xl backdrop-blur-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <Button
                        variant="ghost"
                        size="lg"
                        className="rounded-[0.65rem] px-8 py-6 text-lg font-semibold backdrop-blur-md bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-700 text-white transition-all duration-300 group-hover:-translate-y-0.5 border-0"
                        onClick={() => router.push('/login')}
                      >
                        <span className="opacity-90 group-hover:opacity-100 transition-opacity">
                          Get Started
                        </span>
                        <ArrowRight className="ml-3 w-5 h-5 opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
                      </Button>
                    </div>

                    {/* Secondary CTA - outlined style */}
                    <Button
                      variant="outline"
                      size="lg"
                      className="px-8 py-6 text-lg rounded-xl border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-all duration-300"
                      onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      Learn More
                    </Button>
                  </>
                ) : !loading && user ? (
                  <Link href="/dashboard">
                    <div className="inline-block group relative bg-gradient-to-b from-black/10 to-white/10 dark:from-white/10 dark:to-black/10 p-px rounded-xl backdrop-blur-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
                      <Button
                        variant="ghost"
                        size="lg"
                        className="rounded-[0.65rem] px-8 py-6 text-lg font-semibold backdrop-blur-md bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-700 text-white transition-all duration-300 group-hover:-translate-y-0.5 border-0"
                      >
                        <span className="opacity-90 group-hover:opacity-100 transition-opacity">
                          Go to Dashboard
                        </span>
                        <ArrowRight className="ml-3 w-5 h-5 opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
                      </Button>
                    </div>
                  </Link>
                ) : (
                  <Button
                    variant="default"
                    size="lg"
                    disabled
                    className="px-8 py-6 text-lg rounded-xl bg-slate-300 text-slate-600"
                  >
                    Loading...
                  </Button>
                )}
              </motion.div>
            </div>

            {/* Features Section - consistent spacing, hover effects */}
            <motion.div
              id="features"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.8 }}
              className="mt-16"
            >
              <h3 className="text-center text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-8">
                Everything you need to manage your business
              </h3>

              {/* Feature Cards Grid - equal margins, consistent styling */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {features.map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2 + index * 0.1, duration: 0.5 }}
                    className="group p-6 rounded-xl bg-white/80 dark:bg-neutral-900/50 border border-slate-200 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-600/50 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-teal-500/10 cursor-default"
                  >
                    {/* Icon container - teal tint */}
                    <div className="w-12 h-12 rounded-lg bg-teal-50 dark:bg-teal-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <feature.icon className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                    </div>
                    <h4 className="font-semibold mb-2 text-slate-900 dark:text-white">
                      {feature.title}
                    </h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {feature.description}
                    </p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>

        {/* Footer */}
        <footer className="py-6 text-center text-slate-500 dark:text-slate-400 text-sm">
          <p>Enterprise Resource Planning System</p>
        </footer>
      </div>
    </BackgroundPaths>
  );
}
