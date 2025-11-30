'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
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
