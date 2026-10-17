import HoyView from './HoyView';

export const dynamic = 'force-dynamic';

/** Hoy — the Admin app's phone home. Admin only (AdminContext bounces others; the action checks the cookie too). */
export default async function HoyPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return <HoyView locale={locale === 'en' ? 'en' : 'es'} />;
}
