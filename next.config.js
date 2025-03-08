/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ttlyfhkrsjjrzxiagzpb.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Disable ESLint during build
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Disable type checking during build
  typescript: {
    ignoreBuildErrors: true,
  },
  // Output settings
  output: 'standalone',
  poweredByHeader: false,
}

module.exports = nextConfig 