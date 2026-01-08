'use client'

/**
 * Login Page - Unity ERP
 *
 * Modernized design with:
 * - Same animated background paths as landing page for consistency
 * - Centered form in a light panel with rounded corners and drop shadow
 * - Cool/neutral color palette (teal/slate)
 * - Clear focus states on inputs
 * - Submit button matches landing page CTA
 * - Loading overlay for smooth login transition
 */

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, BarChart3, Users, Package } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { BackgroundPaths } from '@/components/ui/background-paths'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginForm) => {
    try {
      console.log('Login attempt with:', { email: data.email })
      setError(null)

      console.log('Calling Supabase auth.signInWithPassword')
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      })

      console.log('Auth response:', { success: !!authData.user, error: authError?.message })

      if (authError) throw authError

      console.log('Login successful, showing redirect screen')
      setIsRedirecting(true)

      // Small delay to ensure auth state propagates
      await new Promise(resolve => setTimeout(resolve, 800))

      router.push('/dashboard')
    } catch (error: any) {
      console.error('Login error:', error)
      setError(error?.message || 'Failed to sign in')
      setIsRedirecting(false)
    }
  }

  // Feature highlights for left panel
  const features = [
    { icon: BarChart3, label: 'Analytics & Reports' },
    { icon: Users, label: 'Staff Management' },
    { icon: Package, label: 'Inventory Control' },
  ]

  return (
    <BackgroundPaths className="fixed inset-0 w-screen h-screen">
      {/* Loading overlay - shows during redirect transition */}
      {isRedirecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="relative">
              <div className="w-16 h-16 border-4 border-teal-500/30 rounded-full"></div>
              <div className="absolute top-0 left-0 w-16 h-16 border-4 border-t-teal-500 rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <p className="text-slate-900 dark:text-white text-lg font-medium mb-1">Signing in</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Redirecting to dashboard...</p>
            </div>
          </motion.div>
        </div>
      )}

      <div className="w-full h-full flex">
        {/* Left side - Branding (hidden on mobile) */}
        <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="relative z-10 text-center"
          >
            {/* Animated title */}
            <h1 className="text-4xl md:text-5xl font-bold tracking-tighter mb-4">
              {"UNITY ERP".split("").map((letter, i) => (
                <motion.span
                  key={i}
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05, type: "spring", stiffness: 150 }}
                  className="inline-block text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-white/80"
                >
                  {letter === " " ? "\u00A0" : letter}
                </motion.span>
              ))}
            </h1>
            <p className="text-sm font-light tracking-[0.15em] uppercase mb-16 text-slate-600 dark:text-slate-400">
              Enterprise Resource Planning
            </p>

            {/* Feature highlights */}
            <div className="flex flex-col gap-4 mt-8">
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.1, duration: 0.5 }}
                  className="flex items-center gap-3 px-6 py-3 rounded-lg bg-white/60 dark:bg-neutral-900/50 border border-slate-200 dark:border-slate-800 backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:border-teal-300 dark:hover:border-teal-600/50"
                >
                  <feature.icon className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  <span className="text-sm tracking-wide text-slate-700 dark:text-slate-300">{feature.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right side - Login form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="w-full max-w-md"
          >
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-8">
              <h1 className="text-2xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-white/80">
                UNITY ERP
              </h1>
            </div>

            {/* Login Card - light panel with rounded corners and soft shadow */}
            <Card className="bg-white/95 dark:bg-neutral-900/80 border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-xl shadow-slate-200/50 dark:shadow-black/20 rounded-2xl">
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-2xl text-center text-slate-900 dark:text-white font-semibold">
                  Welcome back
                </CardTitle>
                <CardDescription className="text-center text-slate-500 dark:text-slate-400">
                  Sign in to your account to continue
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  {/* Email field - clear focus state */}
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-slate-700 dark:text-slate-300">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      className="bg-white dark:bg-neutral-800/50 border-slate-300 dark:border-slate-700 focus:border-teal-500 focus:ring-teal-500/20 dark:focus:border-teal-500 rounded-lg transition-colors"
                      {...register('email')}
                    />
                    {errors.email && (
                      <p className="text-sm text-red-500">{errors.email.message}</p>
                    )}
                  </div>
                  {/* Password field - clear focus state */}
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      className="bg-white dark:bg-neutral-800/50 border-slate-300 dark:border-slate-700 focus:border-teal-500 focus:ring-teal-500/20 dark:focus:border-teal-500 rounded-lg transition-colors"
                      {...register('password')}
                    />
                    {errors.password && (
                      <p className="text-sm text-red-500">{errors.password.message}</p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4 pt-2">
                  {/* Submit button - matches landing page CTA style */}
                  <Button
                    type="submit"
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-lg py-5 font-semibold shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all duration-300 hover:scale-[1.01]"
                    size="lg"
                    disabled={isSubmitting}
                    onClick={handleSubmit(onSubmit)}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </Button>
                  <div className="text-sm text-slate-500 dark:text-slate-400 text-center">
                    <Link href="/forgot-password" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                      Forgot your password?
                    </Link>
                  </div>
                </CardFooter>
              </form>
            </Card>

            {/* Footer */}
            <p className="text-center text-sm mt-6 text-slate-500 dark:text-slate-400">
              Secure enterprise login
            </p>
          </motion.div>
        </div>
      </div>
    </BackgroundPaths>
  )
}
