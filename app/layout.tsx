import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { Providers } from "@/components/common/providers";
import { RootLayout as AppRootLayout } from "@/components/layout/root-layout";
import { ThemeProvider } from '@/components/common/theme-provider';
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Unity ERP",
    template: "%s",
  },
  description: "Internal ERP system built with modern React stack",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  themeColor: "#09090b",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Unity ERP",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("dark", inter.variable)}
      suppressHydrationWarning
    >
      <body className={cn("antialiased min-h-screen bg-background", inter.className)}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="unity-theme"
        >
          <Providers>
            <AppRootLayout>{children}</AppRootLayout>
          </Providers>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
