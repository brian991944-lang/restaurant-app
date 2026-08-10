'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PayrollTab } from '@/lib/payrollTab';

/**
 * `PayrollTab` and `readTab` deliberately live in @/lib/payrollTab, which has no
 * 'use client' directive. The server page has to call readTab, and a function
 * exported from THIS file cannot be called from the server — only rendered as a
 * component. Re-exporting either of them from here would rebuild that trap.
 */

/**
 * The top-level Configuración / Reportes switch.
 *
 * A client component only because it has to preserve the REST of the query
 * string: ?week and ?dept must survive a tab change, so that coming back to
 * Reportes returns you to the week and department you left, not to the default
 * week. That is the same reason PayrollWeekTable clones its params rather than
 * pushing a bare `?dept=`.
 */
export default function PayrollTabs({ active }: { active: PayrollTab }) {
    const t = useTranslations('Payroll');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (next: PayrollTab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', next);
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
            {([['reportes', t('tab_reportes')], ['config', t('tab_config')]] as const).map(([key, label]) => (
                <button
                    key={key}
                    onClick={() => go(key)}
                    aria-current={active === key ? 'page' : undefined}
                    style={{
                        minHeight: '52px', padding: '0 1.4rem', borderRadius: '8px',
                        fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                        color: active === key ? '#fff' : 'var(--text-primary)',
                        background: active === key ? 'var(--accent-primary)' : 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                    }}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
