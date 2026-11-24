'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Refrigerator, Snowflake, Printer, Minus, Plus } from 'lucide-react';
import { getLabelProduct, type LabelProduct } from '@/app/actions/labels';
import { expiryDate, formatLabelDate, formatLabelTime, shelfLifeDays, splitLabelName, type LabelStorage } from '@/lib/labels';

// Etiqueta para el envase: asks where the product is being stored (nevera or
// congelador), works out the expiration date from the product's shelf life,
// and prints through the tablet's own print dialog (AirPrint → Brother QL,
// 62 mm roll). The printable labels are portaled straight under <body> so the
// print stylesheet can hide the rest of the app without any ancestor getting
// in the way.

const LABEL_W_MM = 62;
// 29 mm fits the side of the 1 1/4 in containers and is a standard Brother DK length (62 x 29).
const LABEL_H_MM = 29;
const MAX_COPIES = 20;

const PRINT_CSS = `
.label-print-root { display: none; }
@page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important; min-height: 0 !important; }
  body > *:not(.label-print-root) { display: none !important; }
  /* iPad printing ignores @page and keeps its own margins, so the printed label
     is sized in container units: it fills whatever width the page gives it and
     everything scales with that width (a fixed 62 mm gets shrunk and clipped).
     1cqw = 1% of the printable width; the numbers are the 62 mm design / 0.62. */
  .label-print-root { display: block !important; container-type: inline-size; }
  .label-print-root .fz-label { width: 100%; height: auto; padding: 0.8cqw 1.6cqw; gap: 1.5cqw; }
  .label-print-root .fz-label:last-child { break-after: auto; page-break-after: auto; }
  .label-print-root .fz-label-name { font-size: 6.26cqw; }
  .label-print-root .fz-label-qty { font-size: 4.84cqw; max-width: 39cqw; border-width: 0.65cqw; padding: 0.5cqw 2cqw; }
  .label-print-root .fz-label-head { gap: 3.2cqw; }
  .label-print-root .fz-label-sub { font-size: 3.7cqw; margin-top: 0.3cqw; }
  .label-print-root .fz-label-row { font-size: 3.98cqw; gap: 3.2cqw; }
  .label-print-root .fz-label-row b { font-size: 4.55cqw; white-space: nowrap; }
  .label-print-root .fz-label-exp { padding: 1cqw 3.2cqw; }
  .label-print-root .fz-label-exp span { font-size: 3.98cqw; }
  .label-print-root .fz-label-exp b { font-size: 6.26cqw; white-space: nowrap; }
  .label-print-root .fz-label-foot { font-size: 3.7cqw; gap: 3.2cqw; }
}
.fz-label {
  width: ${LABEL_W_MM}mm; height: ${LABEL_H_MM}mm; box-sizing: border-box;
  padding: 1.5mm 3mm; overflow: hidden;
  display: flex; flex-direction: column; justify-content: space-between;
  background: #fff; color: #000;
  font-family: Arial, Helvetica, sans-serif; line-height: 1.12;
  break-after: page; page-break-after: always;
}
.fz-label-name { font-size: 11pt; font-weight: 800; text-transform: uppercase; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.fz-label-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 2mm; }
.fz-label-qty { flex: none; max-width: 24mm; border: 0.4mm solid #000; padding: 0.3mm 1.2mm; font-size: 8.5pt; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fz-label-sub { font-size: 6.5pt; font-weight: 600; margin-top: 0.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fz-label-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 7pt; gap: 2mm; }
.fz-label-row b { font-size: 8pt; }
.fz-label-exp { background: #000; color: #fff; padding: 0.6mm 2mm; display: flex; justify-content: space-between; align-items: baseline; font-weight: 800; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.fz-label-exp span { font-size: 7pt; }
.fz-label-exp b { font-size: 11pt; text-transform: uppercase; }
.fz-label-foot { display: flex; justify-content: space-between; font-size: 6.5pt; font-weight: 700; text-transform: uppercase; gap: 2mm; }
.fz-label-foot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

interface Props {
    ingredientId: string;
    /** Shown while the product loads, and used if the lookup fails. */
    fallbackName: string;
    cookNames?: string;
    locale: 'es' | 'en';
    onClose: () => void;
}

export default function LabelPrintModal({ ingredientId, fallbackName, cookNames, locale, onClose }: Props) {
    const t = useTranslations('Labels');
    const [product, setProduct] = useState<LabelProduct | null>(null);
    const [storage, setStorage] = useState<LabelStorage | null>(null);
    const [copies, setCopies] = useState(1);
    const [quantity, setQuantity] = useState(''); // optional, e.g. "15 croquetas"; blank prints nothing
    const [made] = useState(() => new Date());
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        let alive = true;
        getLabelProduct(ingredientId).then(res => { if (alive && res.product) setProduct(res.product); });
        return () => { alive = false; };
    }, [ingredientId]);

    const fullName = product ? (locale === 'es' ? (product.nameEs || product.name) : product.name) : fallbackName;
    const { main, sub } = useMemo(() => splitLabelName(fullName), [fullName]);

    const days = storage ? shelfLifeDays(storage, product?.fridgeDays, product?.freezerDays) : null;
    const expires = storage && days ? expiryDate(made, storage, days) : null;

    const fridgeDays = shelfLifeDays('FRIDGE', product?.fridgeDays, product?.freezerDays);
    const freezerDays = shelfLifeDays('FREEZER', product?.fridgeDays, product?.freezerDays);

    const label = (key: number) => (
        <div className="fz-label" key={key}>
            <div>
                <div className="fz-label-head">
                    <div className="fz-label-name">{main}</div>
                    {quantity.trim() && <div className="fz-label-qty">{quantity.trim()}</div>}
                </div>
                {sub && <div className="fz-label-sub">{sub}</div>}
            </div>
            <div className="fz-label-row">
                <span>{t('made')}</span>
                <b>{formatLabelDate(made, locale)} · {formatLabelTime(made, locale)}</b>
            </div>
            <div className="fz-label-exp">
                <span>{t('expires')}</span>
                <b>{expires ? formatLabelDate(expires, locale) : '—'}</b>
            </div>
            <div className="fz-label-foot">
                <span>{storage === 'FREEZER' ? t('freezer') : t('fridge')}</span>
                <span>{cookNames || ''}</span>
            </div>
        </div>
    );

    const storageButton = (value: LabelStorage, Icon: typeof Snowflake, text: string, d: number) => {
        const on = storage === value;
        return (
            <button
                type="button"
                onClick={() => setStorage(value)}
                style={{
                    flex: 1, minHeight: '92px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                    borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
                    border: `2px solid ${on ? 'var(--accent-primary)' : 'var(--border)'}`,
                    background: on ? 'rgba(59,130,246,0.12)' : 'transparent',
                    color: 'var(--text-primary)',
                }}
            >
                <Icon size={26} color={on ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{text}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('days', { count: d })}</span>
            </button>
        );
    };

    const stepStyle = { width: '44px', height: '44px', borderRadius: '10px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <style>{PRINT_CSS}</style>
            <div style={{ background: 'var(--bg-primary)', padding: '1.5rem', borderRadius: '12px', width: '440px', maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', border: '1px solid var(--border)' }}>
                <h3 style={{ margin: '0 0 0.25rem 0' }}>{t('title')}</h3>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.25rem 0' }}>{fullName}</p>

                <div style={{ fontWeight: 600, marginBottom: '0.6rem' }}>{t('where')}</div>
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    {storageButton('FRIDGE', Refrigerator, t('fridge'), fridgeDays)}
                    {storageButton('FREEZER', Snowflake, t('freezer'), freezerDays)}
                </div>

                {storage && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
                        <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.15)' }}>
                            {label(-1)}
                        </div>
                    </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                    <span style={{ fontWeight: 600 }}>{t('quantity')} <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>{t('optional')}</span></span>
                    <input
                        type="text"
                        value={quantity}
                        maxLength={18}
                        onChange={e => setQuantity(e.target.value)}
                        placeholder={t('quantity_placeholder')}
                        style={{ width: '170px', height: '44px', padding: '0 0.75rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '1rem' }}
                    />
                </label>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <span style={{ fontWeight: 600 }}>{t('copies')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button type="button" aria-label={t('fewer')} style={stepStyle} onClick={() => setCopies(c => Math.max(1, c - 1))}><Minus size={18} /></button>
                        <span style={{ minWidth: '2ch', textAlign: 'center', fontSize: '1.25rem', fontWeight: 700 }}>{copies}</span>
                        <button type="button" aria-label={t('more')} style={stepStyle} onClick={() => setCopies(c => Math.min(MAX_COPIES, c + 1))}><Plus size={18} /></button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onClose} className="btn-secondary" style={{ minHeight: '44px', padding: '0.75rem 1.25rem' }}>{t('close')}</button>
                    <button type="button" onClick={() => window.print()} className="btn-primary" disabled={!storage}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: storage ? 1 : 0.5 }}>
                        <Printer size={18} /> {t('print')}
                    </button>
                </div>
            </div>

            {mounted && storage && createPortal(
                <div className="label-print-root">
                    {Array.from({ length: copies }, (_, i) => label(i))}
                </div>,
                document.body,
            )}
        </div>
    );
}
