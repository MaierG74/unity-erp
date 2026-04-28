/** @type {import('next').NextConfig} */
const nextConfig = {
  // Temporary: unblock build to verify UI while we fix types
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Next 16 production builds were spawning enough workers to exhaust memory on
    // local machines. Keep build parallelism conservative and favor stability.
    cpus: 2,
    staticGenerationMaxConcurrency: 1,
    // Next 16.1+ enables the Turbopack dev filesystem cache by default. Disable
    // it locally to prevent unbounded .next/turbopack growth during next dev.
    turbopackFileSystemCacheForDev: false,
  },
  // Ensure server bundling of ESM packages like tailwind-merge to avoid missing vendor-chunk errors
  transpilePackages: [
    'tailwind-merge',
    '@radix-ui/react-avatar',
    '@radix-ui/react-context',
    'date-fns',
    'react-day-picker',
    'recharts',
    'd3-shape',
    'victory-vendor',
  ],
  // Allow Supabase Storage images in <Image>
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ttlyfhkrsjjrzxiagzpb.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
