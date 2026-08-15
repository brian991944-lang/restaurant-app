'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EXPENSE_TABS, type ExpenseTab } from '@/lib/reportsTab';

/** Label key per expense. Exhaustive by type, so a new expense cannot be added
 *  to the union without also being given a label. */
const EXPENSE_LABEL_KEY: Record<ExpenseTab, string> = {
    nomina: 'exp_nomina',
};

/**
 * The sub-tab bar inside Gastos.
 *
 * One tab today. It is still a bar, and still driven off EXPENSE_TABS, because
 * the alternative — a bare heading now, a bar later — means the second expense
 * arrives with a layout change attached to it. It writes ?exp, a different
 * parameter from the top-level ?tab, so the two levels cannot reinterpret each
 * other's values.
 */
export default function ExpenseTabs({ active }: { active: ExpenseTab }) {
    const t = useTranslations('Reports');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (next: ExpenseTab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('exp', next);
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} data-testid="expense-tabs">
            {EXPENSE_TABS.map(key => (
                <button
                    key={key}
                    onClick={() => go(key)}
                    aria-current={active === key ? 'page' : undefined}
                    data-testid={`expense-tab-${key}`}
                    style={{
                        minHeight: '46px', padding: '0 1.1rem', borderRadius: '8px',
                        fontSize: '1.02rem', fontWeight: 600, cursor: 'pointer',
                        color: active === key ? '#fff' : 'var(--text-primary)',
                        background: active === key ? 'var(--accent-secondary)' : 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                    }}
                >
                    {t(EXPENSE_LABEL_KEY[key])}
                </button>
            ))}
        </div>
    );
}
