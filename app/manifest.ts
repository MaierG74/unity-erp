import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Unity ERP',
    short_name: 'Unity',
    description: 'Internal ERP system',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    shortcuts: [
      {
        name: 'Upload Delivery Note',
        short_name: 'Upload',
        url: '/upload',
        description: 'Quick upload a delivery note photo to a purchase order',
        icons: [
          {
            src: '/icon-upload-96.png',
            sizes: '96x96',
            type: 'image/png',
          },
        ],
      },
      {
        name: 'Purchasing',
        short_name: 'Purchasing',
        url: '/purchasing',
        description: 'View purchasing dashboard',
      },
    ],
  };
}
