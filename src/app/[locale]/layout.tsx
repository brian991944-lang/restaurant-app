import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import Sidebar from '@/components/Sidebar';
import AppLayout from '@/components/AppLayout';
import { ThemeProvider } from '@/components/ThemeProvider';
import PwaRegister from '@/components/PwaRegister';
import type { Metadata, Viewport } from 'next';
import '../globals.css';

// PWA metadata for the OPS app (installable from the browser on a phone).
// Separate manifest, icons and service worker from the public /menu install —
// that one stays scoped to /menu and keeps its offline cache; this one caches
// nothing. See public/app-manifest.webmanifest and components/PwaRegister.tsx.
export const metadata: Metadata = {
  title: 'Fusionista - Restaurant Management',
  description: 'Manage inventory, schedules, and operations',
  manifest: '/app-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Fusionista Ops',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/icons/app-apple-touch-icon.png',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#181c1f',
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages({ locale });

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            <PwaRegister />
            <div style={{ height: '100vh' }}>
              <AppLayout locale={locale}>
                {children}
              </AppLayout>
            </div>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
