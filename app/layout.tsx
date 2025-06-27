import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { RootLayout as AppRootLayout } from "@/components/layout/root-layout";
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from "@/components/ui/toaster";

// Use only the Inter font which is already working
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Unity ERP",
  description: "Internal ERP system built with modern React stack",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  console.log("Root layout rendering with simplified structure");
  
  return (
    <html lang="en" className={`dark ${inter.className}`} suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background">
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
