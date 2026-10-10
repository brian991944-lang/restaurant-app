import { redirect } from 'next/navigation';
import { analyticsHref } from '@/lib/analyticsView';

/**
 * /sales moved under Analytics. The route stays so a bookmark or a tablet tab
 * left on the old address lands on the same panel rather than a 404.
 */
export default async function SalesRedirect({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(analyticsHref(locale, 'ventas'));
}
