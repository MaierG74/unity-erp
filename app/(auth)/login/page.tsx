'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { useTheme } from 'next-themes'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDarkMode = resolvedTheme === 'dark'

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

  const features = [
    { icon: BarChart3, label: 'Analytics & Reports' },
    { icon: Users, label: 'Staff Management' },
    { icon: Package, label: 'Inventory Control' },
  ]

  return (
    <div className={`fixed inset-0 w-screen h-screen ${isDarkMode ? 'bg-[#0a0a0f]' : 'bg-gradient-to-br from-stone-100 via-orange-50/30 to-stone-100'}`}>
      {/* Loading overlay */}
      {isRedirecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-orange-500/30 rounded-full"></div>
              <div className="absolute top-0 left-0 w-16 h-16 border-4 border-t-orange-500 rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <p className="text-white text-lg font-light tracking-wide mb-1">Signing in</p>
              <p className="text-gray-400 text-sm">Redirecting to dashboard...</p>
            </div>
          </div>
        </div>
      )}

      {/* Decorative gradient orbs */}
      <div className={`absolute top-0 left-0 w-[500px] h-[500px] ${isDarkMode ? 'bg-orange-600/20' : 'bg-orange-400/20'} rounded-full blur-[120px] pointer-events-none -translate-x-1/3 -translate-y-1/3`} />
      <div className={`absolute bottom-0 right-0 w-[400px] h-[400px] ${isDarkMode ? 'bg-orange-500/15' : 'bg-orange-300/20'} rounded-full blur-[100px] pointer-events-none translate-x-1/3 translate-y-1/3`} />

      <div className="w-full h-full flex relative z-10">
        {/* Left side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative">
          <div className="relative z-10 text-center">
            <h1 className={`text-4xl md:text-5xl font-extralight tracking-[0.2em] uppercase mb-4 ${isDarkMode ? 'text-white' : 'text-[#F26B3A]'}`}>
              Unity ERP
            </h1>
            <p className={`text-sm font-light tracking-[0.15em] uppercase mb-16 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Enterprise Resource Planning
            </p>

            {/* Feature highlights */}
            <div className="flex flex-col gap-4 mt-8">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 px-6 py-3 rounded-lg ${
                    isDarkMode
                      ? 'bg-white/5 border border-white/10'
                      : 'bg-white/60 border border-orange-200/50'
                  } backdrop-blur-sm transition-all duration-300 hover:scale-105`}
                >
                  <feature.icon className={`w-5 h-5 ${isDarkMode ? 'text-orange-400' : 'text-[#F26B3A]'}`} />
                  <span className={`text-sm tracking-wide ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{feature.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right side - Login form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-8">
              <h1 className={`text-2xl font-extralight tracking-[0.2em] uppercase ${isDarkMode ? 'text-white' : 'text-[#F26B3A]'}`}>
                Unity ERP
              </h1>
            </div>

            <Card className={`${isDarkMode ? 'bg-gray-900/50 border-gray-800' : 'bg-white/80 border-gray-200'} backdrop-blur-xl shadow-2xl`}>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className={`text-2xl text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Welcome back
                </CardTitle>
                <CardDescription className="text-center">
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
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      className={`${isDarkMode ? 'bg-gray-800/50 border-gray-700 focus:border-orange-500' : 'bg-white border-gray-300 focus:border-orange-500'}`}
                      {...register('email')}
                    />
                    {errors.email && (
                      <p className="text-sm text-destructive">{errors.email.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      className={`${isDarkMode ? 'bg-gray-800/50 border-gray-700 focus:border-orange-500' : 'bg-white border-gray-300 focus:border-orange-500'}`}
                      {...register('password')}
                    />
                    {errors.password && (
                      <p className="text-sm text-destructive">{errors.password.message}</p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4 pt-2">
                  <Button
                    type="submit"
                    className="w-full bg-[#F26B3A] hover:bg-[#E25A29] text-white shadow-lg shadow-orange-500/20 transition-all duration-300 hover:shadow-orange-500/30 hover:scale-[1.02]"
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
                  <div className="text-sm text-muted-foreground text-center">
                    <Link href="/forgot-password" className="hover:text-[#F26B3A] transition-colors">
                      Forgot your password?
                    </Link>
                  </div>
                </CardFooter>
              </form>
            </Card>

            {/* Footer */}
            <p className={`text-center text-sm mt-6 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Secure enterprise login
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
