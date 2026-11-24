import EtiquetasView from './EtiquetasView';

export const dynamic = 'force-dynamic';

/** Etiquetas — print a container label for any kitchen product. Open to cooks; only the shelf-life days are admin-only. */
export default async function EtiquetasPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return <EtiquetasView locale={locale === 'en' ? 'en' : 'es'} />;
}
