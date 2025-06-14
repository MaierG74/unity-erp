'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BypassOrdersPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to orders page after a short delay
    const timer = setTimeout(() => {
      router.push('/orders');
    }, 500);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h1 className="text-2xl font-bold mb-4">Development Bypass</h1>
      <p className="mb-4">Redirecting to Orders page...</p>
      <div className="w-16 h-16 border-t-4 border-blue-500 border-solid rounded-full animate-spin"></div>
    </div>
  );
} 