'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const hasAutoRetried = useRef(false)

  useEffect(() => {
    console.error('Page error:', error)
  }, [error])

  // Auto-recover when a valid auth session is restored (e.g. after logout/login in another tab)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !hasAutoRetried.current) {
        hasAutoRetried.current = true
        setTimeout(() => reset(), 500)
      }
    })
    return () => subscription.unsubscribe()
  }, [reset])

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2>Something went wrong!</h2>
      <p>An error occurred while loading this page.</p>
      <div style={{ marginTop: '20px' }}>
        <button onClick={() => reset()} style={{ marginRight: '10px', padding: '8px 16px' }}>
          Try again
        </button>
        <button onClick={() => window.location.href = '/'} style={{ padding: '8px 16px' }}>
          Go to Home
        </button>
      </div>
    </div>
  )
}
