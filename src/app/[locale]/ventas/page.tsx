import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import VentasPhone from './VentasPhone';

export const dynamic = 'force-dynamic';

/** Ventas — the phone sales screen (same rows as Analytics › Ventas). Admin only. */
export default async function VentasPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const today = lastToastBusinessDates(1)[0];
    return <VentasPhone locale={locale === 'en' ? 'en' : 'es'} today={today} />;
}
