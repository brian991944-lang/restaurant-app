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
    // Both languages are built in (sidebar / Más → Idioma). A browser's machine
    // translation of the English UI is what the family in Peru saw — never again.
    google: 'notranslate',
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
        {/* Admin phone (lib/adminDevice.ts): keep the page invisible until AdminContext
            has rendered its first decision — lock screen or page — so no sales figure
            flashes before the fingerprint prompt. AdminProvider lifts the attribute. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('fusionista_admin_device')==='1')document.documentElement.setAttribute('data-admin-device','1')}catch(e){}" }}
        />
        {/* "Vista completa en el navegador" (lib/viewMode.ts): in a browser tab only, lay out
            at desktop width before the first paint; the installed app keeps the phone layout. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: "try{var f=localStorage.getItem('fusionista_browser_full_view');if((f==='1'||(f!=='0'&&localStorage.getItem('fusionista_admin_device')==='1'))&&matchMedia('(display-mode: browser)').matches&&navigator.standalone!==true){document.querySelectorAll('meta[name=\"viewport\"]').forEach(function(m){m.setAttribute('content','width=1100')})}}catch(e){}" }}
        />
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
