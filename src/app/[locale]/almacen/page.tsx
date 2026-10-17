import AlmacenView from './AlmacenView';

export const dynamic = 'force-dynamic';

/**
 * Almacén — admin-only storage: Brian's house, the basement (kitchen side)
 * and the basement (salon side, which is the salon's existing Bodega).
 * AdminContext bounces non-admins off /almacen on the client; every server
 * action behind this page also checks the admin cookie itself.
 */
export default async function AlmacenPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return <AlmacenView locale={locale === 'en' ? 'en' : 'es'} />;
}
