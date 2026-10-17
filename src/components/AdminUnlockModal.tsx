'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Fingerprint, ShieldCheck, Lock, X, Loader2, Check } from 'lucide-react';
import {
    passkeySupported,
    isPasskeyEnrolledHere,
    isPasskeyOfferDismissed,
    dismissPasskeyOffer,
    enrollPasskey,
    unlockWithPasskey,
} from '@/lib/adminPasskeyClient';

/**
 * The Admin unlock sheet.
 *
 * Step "unlock": fingerprint / Face ID first on a device that has one
 * enrolled (it auto-prompts), password underneath as the fallback. The
 * password is never compared in the browser — it goes to /api/admin/login.
 *
 * Step "offer": shown once per device right after a password unlock when the
 * device could use a passkey but hasn't enrolled one. "Not now" is remembered.
 *
 * variant "sheet" (default): the dismissable modal the sidebar opens.
 * variant "screen": the Admin install's lock screen — solid background, no
 * close button, no backdrop/Esc dismiss. Same unlock logic, same endpoints.
 */
export default function AdminUnlockModal({
    open,
    onClose,
    onUnlocked,
    variant = 'sheet',
    footnote,
}: {
    open: boolean;
    onClose: () => void;
    onUnlocked: () => void;
    variant?: 'sheet' | 'screen';
    /** Screen variant only: a line under the card (e.g. how to install the Admin app). */
    footnote?: React.ReactNode;
}) {
    const t = useTranslations('Nav');
    const dismissable = variant === 'sheet';

    const [step, setStep] = useState<'unlock' | 'offer'>('unlock');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState<'password' | 'passkey' | 'enroll' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [passkeyAvailable, setPasskeyAvailable] = useState(false);
    const [enrolled, setEnrolled] = useState(false);
    const [enrolledJustNow, setEnrolledJustNow] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoPrompted = useRef(false);

    // Reset on every open; auto-prompt the fingerprint on enrolled devices.
    useEffect(() => {
        if (!open) { autoPrompted.current = false; return; }
        setStep('unlock');
        setPassword('');
        setError(null);
        setBusy(null);
        setEnrolledJustNow(false);
        const here = isPasskeyEnrolledHere();
        setEnrolled(here);
        let cancelled = false;
        passkeySupported().then(ok => {
            if (cancelled) return;
            setPasskeyAvailable(ok);
            if (ok && here && !autoPrompted.current) {
                autoPrompted.current = true;
                void runPasskey();
            } else if (!ok || !here) {
                inputRef.current?.focus();
            }
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Esc closes (the sheet only — the lock screen has nowhere to go back to).
    useEffect(() => {
        if (!open || !dismissable) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, busy, onClose, dismissable]);

    const finish = () => {
        onUnlocked();
        onClose();
    };

    const runPasskey = async () => {
        if (busy) return;
        setBusy('passkey');
        setError(null);
        const result = await unlockWithPasskey();
        setBusy(null);
        if (result === 'ok') { finish(); return; }
        if (result === 'none') { setError(t('passkey_none')); setEnrolled(false); }
        else if (result === 'failed') setError(t('passkey_unlock_failed'));
        // 'cancelled': the OS sheet was dismissed — just show the password.
        inputRef.current?.focus();
    };

    const runPassword = async () => {
        if (busy || !password) return;
        setBusy('password');
        setError(null);
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            if (res.ok) {
                setPassword('');
                if (passkeyAvailable && !isPasskeyEnrolledHere() && !isPasskeyOfferDismissed()) {
                    setBusy(null);
                    setStep('offer');
                    return;
                }
                finish();
                return;
            }
            if (res.status === 500) setError(t('login_not_configured'));
            else setError(t('access_denied'));
        } catch {
            setError(t('login_network_error'));
        }
        setBusy(null);
        inputRef.current?.select();
    };

    const runEnroll = async () => {
        if (busy) return;
        setBusy('enroll');
        setError(null);
        const result = await enrollPasskey();
        setBusy(null);
        if (result === 'ok') {
            setEnrolledJustNow(true);
            setTimeout(finish, 1100);
            return;
        }
        if (result === 'failed') setError(t('passkey_enable_failed'));
        // 'cancelled': they backed out of the OS sheet — leave the offer up.
    };

    const skipEnroll = () => {
        dismissPasskeyOffer();
        finish();
    };

    if (!open) return null;

    return (
        <div
            onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget && !busy) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: dismissable ? 'rgba(0,0,0,0.55)' : 'var(--bg-primary)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem',
                padding: '1rem',
                animation: 'adminSheetFade 160ms ease-out',
            }}
        >
            <style>{`
                @keyframes adminSheetFade { from { opacity: 0 } to { opacity: 1 } }
                @keyframes adminSheetRise { from { opacity: 0; transform: translateY(12px) scale(0.98) } to { opacity: 1; transform: none } }
                @keyframes adminSpin { to { transform: rotate(360deg) } }
                .admin-sheet-primary:disabled { opacity: .6; cursor: default; transform: none !important; }
            `}</style>

            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-sheet-title"
                style={{
                    width: '100%', maxWidth: '380px',
                    background: 'var(--bg-secondary)',
                    border: 'var(--glass-border)',
                    borderRadius: '20px',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
                    padding: '1.75rem 1.5rem 1.5rem',
                    position: 'relative',
                    animation: 'adminSheetRise 200ms cubic-bezier(.2,.8,.2,1)',
                }}
            >
                {dismissable && (
                    <button
                        onClick={onClose}
                        disabled={!!busy}
                        aria-label={t('cancel')}
                        style={{
                            position: 'absolute', top: '0.9rem', right: '0.9rem',
                            width: 32, height: 32, borderRadius: 16,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', color: 'var(--text-secondary)',
                        }}
                    >
                        <X size={18} />
                    </button>
                )}

                {/* Badge */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                        boxShadow: '0 10px 28px rgba(59,130,246,0.35)',
                        color: 'white',
                    }}>
                        {step === 'offer'
                            ? (enrolledJustNow ? <Check size={30} strokeWidth={2.5} /> : <Fingerprint size={30} />)
                            : <ShieldCheck size={30} />}
                    </div>
                </div>

                {step === 'unlock' ? (
                    <>
                        <h3 id="admin-sheet-title" style={{ margin: 0, textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {t('admin_access')}
                        </h3>
                        <p style={{ margin: '0.4rem 0 1.4rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {t('admin_subtitle')}
                        </p>

                        {passkeyAvailable && (
                            <>
                                <button
                                    onClick={runPasskey}
                                    disabled={!!busy}
                                    className="btn-primary admin-sheet-primary"
                                    style={{
                                        width: '100%', padding: '0.9rem', borderRadius: '12px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                                        fontSize: '0.95rem',
                                    }}
                                >
                                    {busy === 'passkey'
                                        ? <Loader2 size={20} style={{ animation: 'adminSpin 0.9s linear infinite' }} />
                                        : <Fingerprint size={20} />}
                                    {busy === 'passkey' ? t('passkey_waiting') : t('passkey_unlock')}
                                </button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.1rem 0' }}>
                                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                                    <span style={{ fontSize: '0.75rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                                        {t('or_divider')}
                                    </span>
                                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                                </div>
                            </>
                        )}

                        <form
                            onSubmit={(e) => { e.preventDefault(); void runPassword(); }}
                            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                        >
                            <div style={{ position: 'relative' }}>
                                <Lock size={16} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                <input
                                    ref={inputRef}
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                                    className="input-field"
                                    placeholder={t('password')}
                                    disabled={busy === 'password'}
                                    style={{ padding: '0.85rem 0.9rem 0.85rem 2.6rem', borderRadius: '12px' }}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={!!busy || !password}
                                className={passkeyAvailable ? 'admin-sheet-primary' : 'btn-primary admin-sheet-primary'}
                                style={{
                                    width: '100%', padding: '0.85rem', borderRadius: '12px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                    fontWeight: 500,
                                    ...(passkeyAvailable ? {
                                        background: 'var(--bg-primary)',
                                        border: 'var(--glass-border)',
                                        color: 'var(--text-primary)',
                                    } : {}),
                                }}
                            >
                                {busy === 'password' && <Loader2 size={18} style={{ animation: 'adminSpin 0.9s linear infinite' }} />}
                                {t('unlock')}
                            </button>
                        </form>

                        <p role="alert" style={{ minHeight: '1.2em', margin: '0.85rem 0 0', textAlign: 'center', fontSize: '0.85rem', color: 'var(--danger)' }}>
                            {error ?? ''}
                        </p>
                    </>
                ) : (
                    <>
                        <h3 id="admin-sheet-title" style={{ margin: 0, textAlign: 'center', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {enrolledJustNow ? t('passkey_enabled') : t('passkey_offer_title')}
                        </h3>
                        <p style={{ margin: '0.4rem 0 1.4rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {enrolledJustNow ? t('passkey_enabled_body') : t('passkey_offer_body')}
                        </p>

                        {!enrolledJustNow && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <button
                                    onClick={runEnroll}
                                    disabled={!!busy}
                                    className="btn-primary admin-sheet-primary"
                                    style={{ width: '100%', padding: '0.9rem', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', fontSize: '0.95rem' }}
                                >
                                    {busy === 'enroll'
                                        ? <Loader2 size={20} style={{ animation: 'adminSpin 0.9s linear infinite' }} />
                                        : <Fingerprint size={20} />}
                                    {t('passkey_enable')}
                                </button>
                                <button
                                    onClick={skipEnroll}
                                    disabled={!!busy}
                                    style={{ width: '100%', padding: '0.7rem', borderRadius: '12px', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.9rem' }}
                                >
                                    {t('passkey_not_now')}
                                </button>
                            </div>
                        )}

                        <p role="alert" style={{ minHeight: '1.2em', margin: '0.85rem 0 0', textAlign: 'center', fontSize: '0.85rem', color: 'var(--danger)' }}>
                            {error ?? ''}
                        </p>
                    </>
                )}
            </div>

            {!dismissable && footnote && (
                <div style={{ maxWidth: '380px', textAlign: 'center', fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--text-secondary)', padding: '0 0.5rem' }}>
                    {footnote}
                </div>
            )}
        </div>
    );
}
