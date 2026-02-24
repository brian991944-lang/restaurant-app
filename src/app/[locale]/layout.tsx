import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import Sidebar from '@/components/Sidebar';
import { ThemeProvider } from '@/components/ThemeProvider';
import '../globals.css';

export const metadata = {
  title: 'Fusionista - Restaurant Management',
  description: 'Manage inventory, schedules, and operations',
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: string };
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
            <div className="layout-container" style={{ flexDirection: 'row', width: '100%', height: '100vh', overflow: 'hidden' }}>
              <Sidebar locale={locale} />
              <main className="page-container" style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                {children}
              </main>
            </div>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
