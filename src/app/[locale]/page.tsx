import { redirect as nativeRedirect } from 'next/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  nativeRedirect(`/${locale}/dashboard`);
}
