/** @type {import('next').NextConfig} */
const nextConfig = {
  // Temporary: unblock build to verify UI while we fix types
  typescript: {
    ignoreBuildErrors: true,
  },
  // Ensure server bundling of ESM packages like tailwind-merge to avoid missing vendor-chunk errors
  transpilePackages: ['tailwind-merge'],
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
