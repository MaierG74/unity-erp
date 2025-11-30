'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Something went wrong!</h2>
          <p>A critical error occurred in the application.</p>
          <button onClick={() => reset()} style={{ marginTop: '20px', padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  )
} 