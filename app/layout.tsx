import type { Metadata } from "next";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import "./globals.css";
import { Providers } from "@/components/providers";
import { RootLayout as AppRootLayout } from "@/components/layout/root-layout";
import { ThemeProvider } from "@/components/theme-provider";

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
  console.log("Root layout rendering");
  
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
