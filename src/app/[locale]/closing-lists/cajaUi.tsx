'use client';

import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { formatBusinessDateEs } from '@/lib/businessDay';
import type { CajaNivel } from '@/lib/cajaRules';

/**
 * Presentation shared by the Caja tab and the corte modal: how a difference
 * is written, how a nivel is badged, how a time is shown. Nothing here judges
 * anything — nivel comes from src/lib/cajaRules or from the server. Every
 * label is read from the "Caja" next-intl namespace.
 */

/** A difference with its sign: +$1.50, −$1.50 (real minus sign), $0.00. */
export function signedMoney(cents: number): string {
    if (cents === 0) return formatMoney(0);
    if (cents < 0) return `−${formatMoney(-cents)}`;
    return `+${formatMoney(cents)}`;
}

/** HH:MM in New York, where the boxes are. */
export function nyTime(d: Date | string): string {
    return new Intl.DateTimeFormat('es', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
}

/**
 * A business date as a long-form heading in the viewer's language. The value
 * is a calendar date pinned to UTC midnight (businessDateToUtcDate), so the
 * English branch formats in UTC for the same reason formatBusinessDateEs
 * does: formatting it in New York would show the previous day.
 */
export function longDate(d: Date, locale: string): string {
    if (locale === 'es') return formatBusinessDateEs(d);
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(d);
}

type Tone = 'green' | 'amber' | 'red' | 'grey' | 'blue';

const TONES: Record<Tone, { bg: string; fg: string }> = {
    green: { bg: '#dcfce7', fg: '#166534' },
    amber: { bg: '#fef3c7', fg: '#92400e' },
    red: { bg: '#fee2e2', fg: '#991b1b' },
    grey: { bg: '#e5e7eb', fg: '#374151' },
    blue: { bg: '#dbeafe', fg: '#1e40af' },
};

export function Chip({ tone, bold = false, children }: { tone: Tone; bold?: boolean; children: React.ReactNode }) {
    const c = TONES[tone];
    return (
        <span style={{
            display: 'inline-block', padding: '0.35rem 0.8rem', borderRadius: '999px',
            fontSize: '0.95rem', fontWeight: bold ? 700 : 600, whiteSpace: 'nowrap',
            background: c.bg, color: c.fg,
        }}>
            {children}
        </span>
    );
}

/**
 * The badge for one judged line. `diffCents` is only read for MENOR and
 * DESCUADRE, where the amount is the finding.
 */
export function NivelBadge({ nivel, diffCents }: { nivel: CajaNivel; diffCents: number }) {
    const t = useTranslations('Caja');
    switch (nivel) {
        case 'OK': return <Chip tone="green">{t('nivel_OK')}</Chip>;
        case 'MENOR': return <Chip tone="amber">{t('nivel_MENOR', { amount: signedMoney(diffCents) })}</Chip>;
        case 'DESCUADRE': return <Chip tone="red" bold>{t('nivel_DESCUADRE', { amount: signedMoney(diffCents) })}</Chip>;
    }
}

export function SinVerificar() {
    const t = useTranslations('Caja');
    return <Chip tone="grey">{t('not_checked')}</Chip>;
}

export function FondoInicial() {
    const t = useTranslations('Caja');
    return <Chip tone="grey">{t('starting_float')}</Chip>;
}

export function PosibleTraslado() {
    const t = useTranslations('Caja');
    return <Chip tone="amber">{t('possible_transfer')}</Chip>;
}
