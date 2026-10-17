import MasView from './MasView';

export const dynamic = 'force-dynamic';

/** Más — the phone's "everything else" screen. Admin only. */
export default async function MasPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return <MasView locale={locale === 'en' ? 'en' : 'es'} />;
}
