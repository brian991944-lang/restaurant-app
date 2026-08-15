'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { REPORTS_TABS, type ReportsTab } from '@/lib/reportsTab';

/**
 * `ReportsTab` and `readReportsTab` deliberately live in @/lib/reportsTab, which
 * has no 'use client' directive. The server page has to call the reader, and a
 * function exported from THIS file cannot be called from the server — only
 * rendered as a component. Re-exporting either from here would rebuild that trap.
 */

/** The label key for each tab. Exhaustive by type: a new tab will not compile
 *  until it has one, which is what stops a tab rendering as a blank button. */
const TAB_LABEL_KEY: Record<ReportsTab, string> = {
    gastos: 'tab_gastos',
    archivos: 'tab_archivos',
};

/**
 * The top-level Gastos / Archivos switch.
 *
 * A client component only so it can preserve the REST of the query string:
 * ?week and ?exp must survive a tab change, so coming back to Gastos returns
 * you to the week you left rather than to the default.
 */
export default function ReportsTabs({ active }: { active: ReportsTab }) {
    const t = useTranslations('Reports');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (next: ReportsTab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', next);
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <div
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}
            data-testid="reports-tabs"
        >
            {REPORTS_TABS.map(key => (
                <button
                    key={key}
                    onClick={() => go(key)}
                    aria-current={active === key ? 'page' : undefined}
                    data-testid={`reports-tab-${key}`}
                    style={{
                        minHeight: '52px', padding: '0 1.4rem', borderRadius: '8px',
                        fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                        color: active === key ? '#fff' : 'var(--text-primary)',
                        background: active === key ? 'var(--accent-primary)' : 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                    }}
                >
                    {t(TAB_LABEL_KEY[key])}
                </button>
            ))}
        </div>
    );
}
