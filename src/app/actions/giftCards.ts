'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { formatMoney, toCents } from '@/lib/money';
import { isAdminSession } from '@/lib/adminGuard';
import { renderGiftCardPdf, occasionLines } from '@/lib/giftCard/render';
import { sendGiftCardEmail } from '@/lib/giftCard/email';

/**
 * Gift cards: issued from the app by any Salón employee, emailed at once from
 * the restaurant's own address, and tracked here (balance, redemptions).
 *
 * Issuing SAVES FIRST and sends second: the row exists as PENDIENTE_ENVIO
 * before the email is attempted, so a mail failure never loses a sale — the
 * card shows "Reenviar" and the email goes out on the next try. The code and
 * the amount never change after issue; only balance, status and the email
 * fields move.
 *
 * Expiry is two years from the issue date (New Jersey's 24-month minimum).
 * Money is integer cents throughout.
 */

const ROUTE = '/[locale]/gift-cards';

/** Two calendar years, by decision (NJ minimum). */
const EXPIRY_YEARS = 2;

/** Issued amounts outside this range are a typo, not a sale. */
const MIN_CENTS = 500;
const MAX_CENTS = 200_000;

/** Code alphabet: no 0/O/1/I so a code read over the phone can't be misheard. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PREFIX = 'FUS';
const CODE_LENGTH = 6;

export type GiftCardErrorKey =
    | 'err_amount' | 'err_email' | 'err_purchaser_email' | 'err_not_found'
    | 'err_not_active' | 'err_redeem_amount' | 'err_redeem_over'
    | 'err_admin_only' | 'err_reason' | 'save_failed';

type Fail = { success: false; error: string; errorKey: GiftCardErrorKey };
const fail = (errorKey: GiftCardErrorKey, error: string): Fail => ({ success: false, error, errorKey });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (s: string) => EMAIL_RE.test(s);

const NY = 'America/New_York';

/** 'MM/DD/YYYY' in New York, as printed on the card. */
function cardDate(d: Date): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: NY, month: '2-digit', day: '2-digit', year: 'numeric' }).format(d);
}

/** 'November 25, 2026' in New York, as written in the email. */
function longDate(d: Date): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

/** Same calendar day `years` on, in New York; Feb 29 lands on Feb 28. */
function addYearsNy(from: Date, years: number): Date {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(from);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const y = get('year') + years;
    const m = get('month');
    const d = Math.min(get('day'), new Date(Date.UTC(y, m, 0)).getUTCDate());
    // End of that day in New York (EST/EDT); good enough for a two-year expiry.
    return new Date(Date.UTC(y, m - 1, d, 23 + 5, 59, 59));
}

function randomCode(): string {
    let s = CODE_PREFIX;
    for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
}

async function uniqueCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
        const code = randomCode();
        const taken = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
        if (!taken) return code;
    }
    throw new Error('No se pudo generar un código único');
}

const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface IssueGiftCardInput {
    amount: string | number;
    toNames?: string;
    fromNames?: string;
    recipientEmail: string;
    purchaserEmail?: string;
    occasion?: string;
    message?: string;
    toastCheck?: string;
    issuedByName?: string;
}

export type IssueGiftCardResult =
    | { success: true; id: string; code: string; emailStatus: 'ENVIADO' | 'ERROR'; emailError: string | null }
    | Fail;

/**
 * Issue a card: validate, save as PENDIENTE_ENVIO, build the PDF, email it,
 * record the outcome. Returns success even when the email failed — the card
 * exists and can be re-sent; the UI shows the email state separately.
 */
export async function issueGiftCard(input: IssueGiftCardInput): Promise<IssueGiftCardResult> {
    const amountCents = toCents(input.amount);
    if (amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
        return fail('err_amount', 'El monto debe estar entre $5.00 y $2,000.00.');
    }
    const recipientEmail = clean(input.recipientEmail, 200);
    if (!isEmail(recipientEmail)) return fail('err_email', 'El correo del destinatario no es válido.');
    const purchaserEmail = clean(input.purchaserEmail, 200);
    if (purchaserEmail && !isEmail(purchaserEmail)) return fail('err_purchaser_email', 'El correo del comprador no es válido.');

    const toNames = clean(input.toNames);
    const fromNames = clean(input.fromNames);
    const occasion = clean(input.occasion, 60);
    const message = clean(input.message, 600);
    const toastCheck = clean(input.toastCheck, 40);
    const issuedByName = clean(input.issuedByName, 80);

    let card: { id: string; code: string; issuedAt: Date; expiresAt: Date };
    try {
        const issuedAt = new Date();
        const code = await uniqueCode();
        card = await prisma.giftCard.create({
            data: {
                code,
                amountCents,
                balanceCents: amountCents,
                toNames: toNames || null,
                fromNames: fromNames || null,
                recipientEmail,
                purchaserEmail: purchaserEmail || null,
                occasion: occasion || null,
                message: message || null,
                toastCheck: toastCheck || null,
                issuedByName: issuedByName || null,
                issuedAt,
                expiresAt: addYearsNy(issuedAt, EXPIRY_YEARS),
            },
            select: { id: true, code: true, issuedAt: true, expiresAt: true },
        });
    } catch (e) {
        console.error('[giftCards] create failed', e);
        return fail('save_failed', 'No se pudo guardar la tarjeta.');
    }

    const sent = await deliver(card.id);
    revalidatePath(ROUTE, 'page');
    return { success: true, id: card.id, code: card.code, emailStatus: sent.ok ? 'ENVIADO' : 'ERROR', emailError: sent.ok ? null : sent.error };
}

/** Build the PDF and send the email for an existing card; records the result on the row. */
async function deliver(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const c = await prisma.giftCard.findUnique({ where: { id } });
    if (!c) return { ok: false, error: 'Tarjeta no encontrada' };
    try {
        const amount = formatMoney(c.amountCents);
        const pdf = await renderGiftCardPdf({
            to: c.toNames ?? '',
            amount,
            from: c.fromNames ?? '',
            expires: cardDate(c.expiresAt),
            code: c.code,
            occasion: c.occasion ? occasionLines(c.occasion) : '',
        });
        await sendGiftCardEmail({
            toNames: c.toNames ?? '',
            fromNames: c.fromNames ?? '',
            amount,
            code: c.code,
            issued: longDate(c.issuedAt),
            expires: longDate(c.expiresAt),
            message: c.message ?? '',
            recipientEmail: c.recipientEmail,
            purchaserEmail: c.purchaserEmail ?? '',
            pdf,
        });
        await prisma.giftCard.update({ where: { id }, data: { emailStatus: 'ENVIADO', emailSentAt: new Date(), emailError: null } });
        return { ok: true };
    } catch (e) {
        const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        console.error('[giftCards] send failed', c.code, error);
        await prisma.giftCard.update({ where: { id }, data: { emailStatus: 'ERROR', emailError: error } }).catch(() => undefined);
        return { ok: false, error };
    }
}

export type ResendResult = { success: true; emailStatus: 'ENVIADO' | 'ERROR'; emailError: string | null } | Fail;

/** Send the card's email again (after an error, or when the guest lost it). */
export async function resendGiftCard(id: string): Promise<ResendResult> {
    const c = await prisma.giftCard.findUnique({ where: { id }, select: { status: true } });
    if (!c) return fail('err_not_found', 'Tarjeta no encontrada.');
    if (c.status === 'ANULADA') return fail('err_not_active', 'La tarjeta está anulada.');
    const sent = await deliver(id);
    revalidatePath(ROUTE, 'page');
    return { success: true, emailStatus: sent.ok ? 'ENVIADO' : 'ERROR', emailError: sent.ok ? null : sent.error };
}

/** The card PDF as bytes, for the in-app preview / download. */
export async function getGiftCardPdf(id: string): Promise<{ success: true; bytes: number[]; filename: string } | Fail> {
    const c = await prisma.giftCard.findUnique({ where: { id } });
    if (!c) return fail('err_not_found', 'Tarjeta no encontrada.');
    const pdf = await renderGiftCardPdf({
        to: c.toNames ?? '',
        amount: formatMoney(c.amountCents),
        from: c.fromNames ?? '',
        expires: cardDate(c.expiresAt),
        code: c.code,
        occasion: c.occasion ? occasionLines(c.occasion) : '',
    });
    return { success: true, bytes: Array.from(pdf), filename: `Fusionista_Gift_Certificate_${c.code}.pdf` };
}

export type RedeemResult = { success: true; balanceCents: number; status: 'ACTIVA' | 'AGOTADA' } | Fail;

/** Take `amount` off a card's balance; the card closes when it reaches zero. */
export async function redeemGiftCard(input: { id: string; amount: string | number; toastCheck?: string; note?: string; byName?: string }): Promise<RedeemResult> {
    const amountCents = toCents(input.amount);
    if (amountCents <= 0) return fail('err_redeem_amount', 'El monto a canjear debe ser mayor que cero.');
    try {
        const result = await prisma.$transaction(async (tx) => {
            const c = await tx.giftCard.findUnique({ where: { id: input.id }, select: { balanceCents: true, status: true } });
            if (!c) return fail('err_not_found', 'Tarjeta no encontrada.');
            if (c.status !== 'ACTIVA') return fail('err_not_active', 'La tarjeta no está activa.');
            if (amountCents > c.balanceCents) return fail('err_redeem_over', 'El monto supera el saldo de la tarjeta.');
            const balanceCents = c.balanceCents - amountCents;
            const status: 'ACTIVA' | 'AGOTADA' = balanceCents === 0 ? 'AGOTADA' : 'ACTIVA';
            await tx.giftCardRedemption.create({
                data: {
                    giftCardId: input.id,
                    amountCents,
                    toastCheck: clean(input.toastCheck, 40) || null,
                    note: clean(input.note, 200) || null,
                    byName: clean(input.byName, 80) || null,
                },
            });
            await tx.giftCard.update({ where: { id: input.id }, data: { balanceCents, status } });
            return { success: true as const, balanceCents, status };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        revalidatePath(ROUTE, 'page');
        return result;
    } catch (e) {
        console.error('[giftCards] redeem failed', e);
        return fail('save_failed', 'No se pudo registrar el canje.');
    }
}

/** Admin only: void a card. The row stays, with the reason, for the record. */
export async function voidGiftCard(input: { id: string; reason: string }): Promise<{ success: true } | Fail> {
    if (!(await isAdminSession())) return fail('err_admin_only', 'Solo un administrador puede anular una tarjeta.');
    const reason = clean(input.reason, 200);
    if (!reason) return fail('err_reason', 'Indica el motivo de la anulación.');
    try {
        await prisma.giftCard.update({ where: { id: input.id }, data: { status: 'ANULADA', anuladaAt: new Date(), anuladaMotivo: reason } });
    } catch {
        return fail('err_not_found', 'Tarjeta no encontrada.');
    }
    revalidatePath(ROUTE, 'page');
    return { success: true };
}

export type GiftCardRow = {
    id: string;
    code: string;
    amountCents: number;
    balanceCents: number;
    toNames: string | null;
    fromNames: string | null;
    recipientEmail: string;
    purchaserEmail: string | null;
    occasion: string | null;
    message: string | null;
    toastCheck: string | null;
    issuedByName: string | null;
    issuedAt: string;      // ISO
    expiresAt: string;     // ISO
    status: 'ACTIVA' | 'AGOTADA' | 'ANULADA';
    emailStatus: 'PENDIENTE_ENVIO' | 'ENVIADO' | 'ERROR';
    emailSentAt: string | null;
    emailError: string | null;
    anuladaMotivo: string | null;
    redemptions: { id: string; amountCents: number; toastCheck: string | null; note: string | null; byName: string | null; at: string }[];
};

/** Newest first. `q` matches code, names or emails. */
export async function listGiftCards(q = '', limit = 200): Promise<GiftCardRow[]> {
    const term = q.trim();
    const where: Prisma.GiftCardWhereInput = term
        ? {
            OR: [
                { code: { contains: term, mode: 'insensitive' } },
                { toNames: { contains: term, mode: 'insensitive' } },
                { fromNames: { contains: term, mode: 'insensitive' } },
                { recipientEmail: { contains: term, mode: 'insensitive' } },
                { purchaserEmail: { contains: term, mode: 'insensitive' } },
            ],
        }
        : {};
    const rows = await prisma.giftCard.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 500),
        include: { redemptions: { orderBy: { at: 'desc' } } },
    });
    return rows.map(r => ({
        id: r.id,
        code: r.code,
        amountCents: r.amountCents,
        balanceCents: r.balanceCents,
        toNames: r.toNames,
        fromNames: r.fromNames,
        recipientEmail: r.recipientEmail,
        purchaserEmail: r.purchaserEmail,
        occasion: r.occasion,
        message: r.message,
        toastCheck: r.toastCheck,
        issuedByName: r.issuedByName,
        issuedAt: r.issuedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        status: r.status,
        emailStatus: r.emailStatus,
        emailSentAt: r.emailSentAt?.toISOString() ?? null,
        emailError: r.emailError,
        anuladaMotivo: r.anuladaMotivo,
        redemptions: r.redemptions.map(x => ({
            id: x.id, amountCents: x.amountCents, toastCheck: x.toastCheck, note: x.note, byName: x.byName, at: x.at.toISOString(),
        })),
    }));
}
