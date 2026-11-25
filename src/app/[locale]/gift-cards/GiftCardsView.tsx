'use client';

import { useState, useTransition, type CSSProperties, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Mail, RefreshCw, Download, Search, Ban, MinusCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import { formatMoney } from '@/lib/money';
import SenderPicker, { type SenderPickerPerson } from '@/components/ui/SenderPicker';
import {
    issueGiftCard, resendGiftCard, redeemGiftCard, voidGiftCard, listGiftCards, getGiftCardPdf,
    type GiftCardRow, type GiftCardErrorKey,
} from '@/app/actions/giftCards';

type Staff = { id: string; name: string };

/** Preset occasions; the value is what gets printed on the card's panel. */
const OCCASIONS = ['', 'Happy Birthday!', 'Happy Holidays!', 'Merry Christmas!', 'Happy Anniversary!', 'Congratulations!', 'Thank You!', 'Buen Provecho!'] as const;
const CUSTOM = '__custom__';

const label: CSSProperties = { fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.3rem', display: 'block' };
const field: CSSProperties = { display: 'flex', flexDirection: 'column' };
const btnGhost: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 0.9rem', borderRadius: '8px',
    border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
};
const btnDanger: CSSProperties = { ...btnGhost, color: 'var(--danger)', borderColor: 'var(--danger)' };

const TONES = {
    ok: { bg: 'rgba(16,185,129,0.15)', fg: '#059669' },
    warn: { bg: 'rgba(245,158,11,0.18)', fg: '#b45309' },
    bad: { bg: 'rgba(239,68,68,0.15)', fg: '#dc2626' },
    muted: { bg: 'rgba(148,163,184,0.2)', fg: 'var(--text-secondary)' },
} as const;

function Chip({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
    const c = TONES[tone];
    return (
        <span style={{ display: 'inline-block', padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', background: c.bg, color: c.fg }}>
            {children}
        </span>
    );
}

function downloadBytes(bytes: number[], filename: string) {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function GiftCardsView({ staff, initialCards }: { staff: Staff[]; initialCards: GiftCardRow[] }) {
    const t = useTranslations('GiftCards');
    const locale = useLocale();
    const { isAdmin } = useAdmin();
    const [cards, setCards] = useState<GiftCardRow[]>(initialCards);
    const [query, setQuery] = useState('');
    const [pending, startTransition] = useTransition();
    const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

    const dateFmt = new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
    const fmtDate = (iso: string) => dateFmt.format(new Date(iso));

    const refresh = (q = query) => startTransition(async () => { setCards(await listGiftCards(q)); });

    const errText = (key: GiftCardErrorKey, fallback: string) => (t.has(key) ? t(key) : fallback);

    return (
        <>
            <IssueForm staff={staff} onIssued={(msg, tone) => { setNotice({ tone, text: msg }); refresh(''); setQuery(''); }} errText={errText} />

            {notice && (
                <div role="status" style={{ padding: '0.9rem 1.2rem', borderRadius: '10px', background: TONES[notice.tone === 'ok' ? 'ok' : 'bad'].bg, color: TONES[notice.tone === 'ok' ? 'ok' : 'bad'].fg, fontWeight: 600 }}>
                    {notice.text}
                </div>
            )}

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)', flex: 1 }}>{t('issued_title')}</h2>
                    <div style={{ position: 'relative', minWidth: '260px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '0.8rem', top: '50%', marginTop: '-9px', color: 'var(--text-secondary)' }} />
                        <input
                            className="input-field"
                            style={{ paddingLeft: '2.4rem' }}
                            placeholder={t('search_placeholder')}
                            value={query}
                            onChange={e => { setQuery(e.target.value); refresh(e.target.value); }}
                        />
                    </div>
                    <button type="button" style={btnGhost} onClick={() => refresh()} disabled={pending}>
                        <RefreshCw size={16} /> {t('refresh')}
                    </button>
                </div>

                {cards.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('empty')}</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {cards.map(c => (
                            <CardRow
                                key={c.id}
                                card={c}
                                isAdmin={isAdmin}
                                staff={staff}
                                fmtDate={fmtDate}
                                errText={errText}
                                onChanged={() => refresh()}
                                onNotice={(text, tone) => setNotice({ tone, text })}
                            />
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

function IssueForm({ staff, onIssued, errText }: {
    staff: Staff[];
    onIssued: (msg: string, tone: 'ok' | 'bad') => void;
    errText: (key: GiftCardErrorKey, fallback: string) => string;
}) {
    const t = useTranslations('GiftCards');
    const [amount, setAmount] = useState('');
    const [toNames, setToNames] = useState('');
    const [fromNames, setFromNames] = useState('');
    const [recipientEmail, setRecipientEmail] = useState('');
    const [purchaserEmail, setPurchaserEmail] = useState('');
    const [occasionPick, setOccasionPick] = useState<string>('');
    const [occasionCustom, setOccasionCustom] = useState('');
    const [message, setMessage] = useState('');
    const [toastCheck, setToastCheck] = useState('');
    const [issuedBy, setIssuedBy] = useState<SenderPickerPerson | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const occasion = occasionPick === CUSTOM ? occasionCustom : occasionPick;

    const reset = () => {
        setAmount(''); setToNames(''); setFromNames(''); setRecipientEmail(''); setPurchaserEmail('');
        setOccasionPick(''); setOccasionCustom(''); setMessage(''); setToastCheck('');
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError(null);
        setBusy(true);
        try {
            const r = await issueGiftCard({
                amount, toNames, fromNames, recipientEmail, purchaserEmail, occasion, message, toastCheck,
                issuedByName: issuedBy?.name ?? '',
            });
            if (!r.success) { setError(errText(r.errorKey, r.error)); return; }
            if (r.emailStatus === 'ENVIADO') {
                onIssued(t('issued_sent', { code: r.code, email: recipientEmail.trim() }), 'ok');
            } else {
                onIssued(t('issued_not_sent', { code: r.code, error: r.emailError ?? '' }), 'bad');
            }
            reset();
        } catch {
            setError(t('save_failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} onSubmit={submit}>
            <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)' }}>{t('issue_title')}</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div style={field}>
                    <label style={label} htmlFor="gc-amount">{t('f_amount')} *</label>
                    <input id="gc-amount" className="input-field" inputMode="decimal" placeholder="100.00" value={amount} onChange={e => setAmount(e.target.value)} required style={{ fontSize: '1.2rem', fontWeight: 700 }} />
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-to">{t('f_to')}</label>
                    <input id="gc-to" className="input-field" placeholder={t('f_to_ph')} value={toNames} onChange={e => setToNames(e.target.value)} maxLength={120} />
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-from">{t('f_from')}</label>
                    <input id="gc-from" className="input-field" placeholder={t('f_from_ph')} value={fromNames} onChange={e => setFromNames(e.target.value)} maxLength={120} />
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-email">{t('f_recipient_email')} *</label>
                    <input id="gc-email" className="input-field" type="email" inputMode="email" autoCapitalize="none" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} required />
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-pemail">{t('f_purchaser_email')}</label>
                    <input id="gc-pemail" className="input-field" type="email" inputMode="email" autoCapitalize="none" value={purchaserEmail} onChange={e => setPurchaserEmail(e.target.value)} />
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-occasion">{t('f_occasion')}</label>
                    <select id="gc-occasion" className="input-field" value={occasionPick} onChange={e => setOccasionPick(e.target.value)}>
                        {OCCASIONS.map(o => <option key={o || 'none'} value={o}>{o || t('occasion_none')}</option>)}
                        <option value={CUSTOM}>{t('occasion_custom')}</option>
                    </select>
                    {occasionPick === CUSTOM && (
                        <input className="input-field" style={{ marginTop: '0.5rem' }} placeholder={t('occasion_custom_ph')} value={occasionCustom} onChange={e => setOccasionCustom(e.target.value)} maxLength={40} />
                    )}
                </div>
                <div style={field}>
                    <label style={label} htmlFor="gc-check">{t('f_toast_check')}</label>
                    <input id="gc-check" className="input-field" value={toastCheck} onChange={e => setToastCheck(e.target.value)} maxLength={40} />
                </div>
            </div>

            <div style={field}>
                <label style={label} htmlFor="gc-message">{t('f_message')}</label>
                <textarea id="gc-message" className="input-field" rows={2} placeholder={t('f_message_ph')} value={message} onChange={e => setMessage(e.target.value)} maxLength={600} />
            </div>

            {staff.length > 0 && <SenderPicker staff={staff} value={issuedBy} onChange={setIssuedBy} label={t('f_issued_by')} />}

            {error && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn-primary" disabled={busy} style={{ minHeight: '52px', fontSize: '1.1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Mail size={18} /> {busy ? t('issuing') : t('issue_and_send')}
                </button>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('issue_hint')}</span>
            </div>
        </form>
    );
}

function CardRow({ card, isAdmin, staff, fmtDate, errText, onChanged, onNotice }: {
    card: GiftCardRow;
    isAdmin: boolean;
    staff: Staff[];
    fmtDate: (iso: string) => string;
    errText: (key: GiftCardErrorKey, fallback: string) => string;
    onChanged: () => void;
    onNotice: (text: string, tone: 'ok' | 'bad') => void;
}) {
    const t = useTranslations('GiftCards');
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<null | 'resend' | 'pdf' | 'redeem' | 'void'>(null);
    const [redeemAmt, setRedeemAmt] = useState('');
    const [redeemCheck, setRedeemCheck] = useState('');
    const [redeemBy, setRedeemBy] = useState<SenderPickerPerson | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [showRedeem, setShowRedeem] = useState(false);
    const [showVoid, setShowVoid] = useState(false);
    const [rowError, setRowError] = useState<string | null>(null);

    const expired = card.status === 'ACTIVA' && new Date(card.expiresAt).getTime() < Date.now();
    const statusChip = card.status === 'ANULADA' ? <Chip tone="bad">{t('st_anulada')}</Chip>
        : card.status === 'AGOTADA' ? <Chip tone="muted">{t('st_agotada')}</Chip>
        : expired ? <Chip tone="warn">{t('st_vencida')}</Chip>
        : <Chip tone="ok">{t('st_activa')}</Chip>;
    const emailChip = card.emailStatus === 'ENVIADO' ? <Chip tone="ok">{t('em_enviado')}</Chip>
        : card.emailStatus === 'ERROR' ? <Chip tone="bad">{t('em_error')}</Chip>
        : <Chip tone="warn">{t('em_pendiente')}</Chip>;

    const resend = async () => {
        setBusy('resend'); setRowError(null);
        try {
            const r = await resendGiftCard(card.id);
            if (!r.success) setRowError(errText(r.errorKey, r.error));
            else if (r.emailStatus === 'ENVIADO') onNotice(t('resent_ok', { code: card.code, email: card.recipientEmail }), 'ok');
            else setRowError(t('resent_fail', { error: r.emailError ?? '' }));
            onChanged();
        } finally { setBusy(null); }
    };

    const pdf = async () => {
        setBusy('pdf'); setRowError(null);
        try {
            const r = await getGiftCardPdf(card.id);
            if (!r.success) setRowError(errText(r.errorKey, r.error));
            else downloadBytes(r.bytes, r.filename);
        } finally { setBusy(null); }
    };

    const redeem = async () => {
        setBusy('redeem'); setRowError(null);
        try {
            const r = await redeemGiftCard({ id: card.id, amount: redeemAmt, toastCheck: redeemCheck, byName: redeemBy?.name ?? '' });
            if (!r.success) setRowError(errText(r.errorKey, r.error));
            else {
                onNotice(t('redeemed_ok', { code: card.code, balance: formatMoney(r.balanceCents) }), 'ok');
                setRedeemAmt(''); setRedeemCheck(''); setShowRedeem(false);
                onChanged();
            }
        } finally { setBusy(null); }
    };

    const doVoid = async () => {
        setBusy('void'); setRowError(null);
        try {
            const r = await voidGiftCard({ id: card.id, reason: voidReason });
            if (!r.success) setRowError(errText(r.errorKey, r.error));
            else { onNotice(t('voided_ok', { code: card.code }), 'ok'); setShowVoid(false); onChanged(); }
        } finally { setBusy(null); }
    };

    const names = [card.toNames && `${t('to_short')} ${card.toNames}`, card.fromNames && `${t('from_short')} ${card.fromNames}`].filter(Boolean).join(' · ');

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', background: 'var(--bg-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)' }}>{card.code}</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(card.balanceCents)}</span>
                {card.balanceCents !== card.amountCents && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('of_amount', { amount: formatMoney(card.amountCents) })}</span>
                )}
                {statusChip}
                {emailChip}
                <span style={{ flex: 1 }} />
                <button type="button" style={btnGhost} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {open ? t('less') : t('more')}
                </button>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>{card.recipientEmail}</span>
                {names && <span>{names}</span>}
                <span>{t('issued_on', { date: fmtDate(card.issuedAt) })} · {t('expires_on', { date: fmtDate(card.expiresAt) })}</span>
            </div>
            {card.emailStatus === 'ERROR' && card.emailError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{t('email_error_detail', { error: card.emailError })}</div>
            )}

            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.3rem 1rem' }}>
                        {card.purchaserEmail && <span>{t('d_purchaser')}: {card.purchaserEmail}</span>}
                        {card.occasion && <span>{t('d_occasion')}: {card.occasion}</span>}
                        {card.toastCheck && <span>{t('d_toast_check')}: {card.toastCheck}</span>}
                        {card.issuedByName && <span>{t('d_issued_by')}: {card.issuedByName}</span>}
                        {card.emailSentAt && <span>{t('d_sent_at')}: {fmtDate(card.emailSentAt)}</span>}
                        {card.anuladaMotivo && <span>{t('d_void_reason')}: {card.anuladaMotivo}</span>}
                        {card.message && <span style={{ gridColumn: '1 / -1' }}>{t('d_message')}: {card.message}</span>}
                    </div>

                    {card.redemptions.length > 0 && (
                        <div style={{ fontSize: '0.92rem' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>{t('redemptions')}</div>
                            {card.redemptions.map(r => (
                                <div key={r.id} style={{ color: 'var(--text-secondary)' }}>
                                    {fmtDate(r.at)} · −{formatMoney(r.amountCents)}{r.toastCheck ? ` · ${t('d_toast_check')} ${r.toastCheck}` : ''}{r.byName ? ` · ${r.byName}` : ''}
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {card.status !== 'ANULADA' && (
                            <button type="button" style={btnGhost} onClick={resend} disabled={busy !== null}>
                                <Mail size={16} /> {busy === 'resend' ? t('sending') : t('resend')}
                            </button>
                        )}
                        <button type="button" style={btnGhost} onClick={pdf} disabled={busy !== null}>
                            <Download size={16} /> {t('download_pdf')}
                        </button>
                        {card.status === 'ACTIVA' && (
                            <button type="button" style={btnGhost} onClick={() => { setShowRedeem(s => !s); setShowVoid(false); }} disabled={busy !== null}>
                                <MinusCircle size={16} /> {t('redeem')}
                            </button>
                        )}
                        {isAdmin && card.status !== 'ANULADA' && (
                            <button type="button" style={btnDanger} onClick={() => { setShowVoid(s => !s); setShowRedeem(false); }} disabled={busy !== null}>
                                <Ban size={16} /> {t('void')}
                            </button>
                        )}
                    </div>

                    {showRedeem && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', padding: '0.9rem', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
                                <div style={field}>
                                    <label style={label}>{t('r_amount')} ({t('r_balance')} {formatMoney(card.balanceCents)})</label>
                                    <input className="input-field" inputMode="decimal" value={redeemAmt} onChange={e => setRedeemAmt(e.target.value)} placeholder="25.00" />
                                </div>
                                <div style={field}>
                                    <label style={label}>{t('f_toast_check')}</label>
                                    <input className="input-field" value={redeemCheck} onChange={e => setRedeemCheck(e.target.value)} maxLength={40} />
                                </div>
                            </div>
                            {staff.length > 0 && <SenderPicker staff={staff} value={redeemBy} onChange={setRedeemBy} label={t('r_by')} />}
                            <div style={{ display: 'flex', gap: '0.6rem' }}>
                                <button type="button" className="btn-primary" onClick={redeem} disabled={busy !== null}>{busy === 'redeem' ? t('saving') : t('r_confirm')}</button>
                                <button type="button" style={btnGhost} onClick={() => setShowRedeem(false)}>{t('cancel')}</button>
                            </div>
                        </div>
                    )}

                    {showVoid && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', padding: '0.9rem', borderRadius: '10px', background: 'var(--bg-secondary)' }}>
                            <div style={field}>
                                <label style={label}>{t('v_reason')}</label>
                                <input className="input-field" value={voidReason} onChange={e => setVoidReason(e.target.value)} maxLength={200} />
                            </div>
                            <div style={{ display: 'flex', gap: '0.6rem' }}>
                                <button type="button" style={btnDanger} onClick={doVoid} disabled={busy !== null}>{busy === 'void' ? t('saving') : t('v_confirm')}</button>
                                <button type="button" style={btnGhost} onClick={() => setShowVoid(false)}>{t('cancel')}</button>
                            </div>
                        </div>
                    )}

                    {rowError && <div role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>{rowError}</div>}
                </div>
            )}
        </div>
    );
}
