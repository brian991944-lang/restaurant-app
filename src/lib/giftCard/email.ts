// Gift card email — the certificate text the restaurant has always sent,
// with the card PDF attached. Sent through Gmail SMTP as the restaurant's
// own address, so the guest sees fusionista.nj@gmail.com, never a personal
// account.
//
// Env (read inside the function, never at module scope):
//   GIFTCARD_SMTP_USER  — the Gmail address to send as (fusionista.nj@gmail.com)
//   GIFTCARD_SMTP_PASS  — a Google "App password" for that account (needs 2-Step
//                         Verification on; Google account → Security → App passwords)
//
// The email is English only for now, by decision.

import nodemailer from 'nodemailer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LOGO_PATH = path.join(process.cwd(), 'src', 'lib', 'giftCard', 'assets', 'logo-email.png');
const LOGO_CID = 'fusionista-logo';

export interface GiftCardEmailData {
    toNames: string;
    fromNames: string;
    amount: string;      // "$150.00"
    code: string;
    issued: string;      // "November 25, 2026"
    expires: string;     // "November 25, 2028"
    message: string;     // personal note, may be empty
    recipientEmail: string;
    purchaserEmail: string;  // CC, may be empty
    pdf: Uint8Array;
}

export const GIFTCARD_EMAIL_SUBJECT = 'Gift Card for Fusionista Peruvian Cuisine';

export function giftCardEmailBody(d: GiftCardEmailData): string {
    const dear = d.toNames.trim() || 'Guest';
    const from = d.fromNames.trim() ? ` from ${d.fromNames.trim()}` : '';
    const note = d.message.trim() ? `\nMessage: ${d.message.trim()}\n` : '';
    return `Dear ${dear},

Enclosed, please find a Fusionista Restaurant Electronic Gift Certificate worth ${d.amount}${from}!

Gift Certificate Code: ${d.code}
Value: ${d.amount}
Date of issue: ${d.issued}
Expires: ${d.expires}
${note}
To redeem your gift certificate, you have two options:
- Print: You can print this email and present the physical copy when you visit Fusionista Restaurant.
- Digital: Alternatively, you can simply show this email on your smartphone or tablet screen at Fusionista Restaurant.

Please keep in mind the following rules and guidelines for using your gift certificate.

Gift Certificate Rules and Guidelines:
1. Redemption: This gift certificate is redeemable only at Fusionista Restaurant and can be used for food and beverage purchases.
2. Expiration Date: Please note that this gift certificate expires on ${d.expires}.
3. No Cash Value: This gift certificate holds no cash value and cannot be exchanged for cash or used to settle outstanding balances.
4. Lost or Stolen: Fusionista Restaurant is not responsible for lost or stolen gift certificates, so please treat it like cash.
5. Multiple Use: You can use this gift certificate for multiple visits until the total value is depleted.
6. Reservations: We recommend making a reservation in advance, mentioning the gift certificate, to ensure a seamless dining experience.
7. Non-Transferable: This gift certificate is non-transferable and can only be used by the recipient (In this case please let us know who the recipient will be).
8. Usage Limits: Please be aware that this gift certificate cannot be combined with any other promotional offers, discounts, or coupons.

We hope you have a delightful dining experience at Fusionista Restaurant and enjoy some delicious meals with us! If you have any questions or need assistance with your reservation, please don't hesitate to contact Fusionista Restaurant's customer service at (862) 846-4874.

Best regards,
Fusionista, Modern Peruvian Cuisine
Management Team
14 Park St. Montclair NJ 07042 | (862) 846-4874
`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The same text as the restaurant's own emails: bold labels, bulleted
 * options, numbered rules, and the signature with the logo (an inline
 * attachment referenced by cid). Inline styles only — email clients drop
 * stylesheets.
 */
export function giftCardEmailHtml(d: GiftCardEmailData): string {
    const dear = esc(d.toNames.trim() || 'Guest');
    const from = d.fromNames.trim() ? ` from ${esc(d.fromNames.trim())}` : '';
    const note = d.message.trim()
        ? `<p style="margin:0 0 16px"><b>Message:</b> ${esc(d.message.trim()).replace(/\n/g, '<br>')}</p>`
        : '';
    const p = (inner: string) => `<p style="margin:0 0 16px">${inner}</p>`;
    const li = (inner: string) => `<li style="margin:0 0 8px">${inner}</li>`;
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:680px;padding:8px 4px">
${p(`Dear ${dear},`)}
${p(`Enclosed, please find a Fusionista Restaurant Electronic Gift Certificate worth <b>${esc(d.amount)}</b>${from}!`)}
<table cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:15px;color:#222222">
  <tr><td style="padding:2px 14px 2px 0"><b>Gift Certificate Code:</b></td><td style="padding:2px 0;font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:1px">${esc(d.code)}</td></tr>
  <tr><td style="padding:2px 14px 2px 0"><b>Value:</b></td><td style="padding:2px 0">${esc(d.amount)}</td></tr>
  <tr><td style="padding:2px 14px 2px 0"><b>Date of issue:</b></td><td style="padding:2px 0">${esc(d.issued)}</td></tr>
  <tr><td style="padding:2px 14px 2px 0"><b>Expires:</b></td><td style="padding:2px 0">${esc(d.expires)}</td></tr>
</table>
${note}
${p('To redeem your gift certificate, you have two options:')}
<ul style="margin:0 0 16px;padding-left:24px">
${li('<b>Print</b>: You can print this email and present the physical copy when you visit Fusionista Restaurant.')}
${li('<b>Digital</b>: Alternatively, you can simply show this email on your smartphone or tablet screen at Fusionista Restaurant.')}
</ul>
${p('Please keep in mind the following rules and guidelines for using your gift certificate.')}
${p('<b>Gift Certificate Rules and Guidelines:</b>')}
<ol style="margin:0 0 16px;padding-left:24px">
${li('<b>Redemption</b>: This gift certificate is redeemable only at Fusionista Restaurant and can be used for food and beverage purchases.')}
${li(`<b>Expiration Date</b>: Please note that this gift certificate expires on ${esc(d.expires)}.`)}
${li('<b>No Cash Value</b>: This gift certificate holds no cash value and cannot be exchanged for cash or used to settle outstanding balances.')}
${li('<b>Lost or Stolen</b>: Fusionista Restaurant is not responsible for lost or stolen gift certificates, so please treat it like cash.')}
${li('<b>Multiple Use</b>: You can use this gift certificate for multiple visits until the total value is depleted.')}
${li('<b>Reservations</b>: We recommend making a reservation in advance, mentioning the gift certificate, to ensure a seamless dining experience.')}
${li('<b>Non-Transferable</b>: This gift certificate is non-transferable and can only be used by the recipient (In this case please let us know who the recipient will be).')}
${li('<b>Usage Limits</b>: Please be aware that this gift certificate cannot be combined with any other promotional offers, discounts, or coupons.')}
</ol>
${p(`We hope you have a delightful dining experience at Fusionista Restaurant and enjoy some delicious meals with us! If you have any questions or need assistance with your reservation, please don't hesitate to contact Fusionista Restaurant's customer service at <a href="tel:+18628464874" style="color:#1a0dab">(862) 846-4874</a>.`)}
${p('Best regards,')}
<div style="margin:4px 0 12px"><img src="cid:${LOGO_CID}" alt="Fusionista" width="200" style="display:block;width:200px;height:auto;border:0"></div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#222222">Fusionista, Modern Peruvian Cuisine</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;font-style:italic;color:#444444;margin:2px 0">Management Team</div>
<div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#444444">14 Park St. Montclair NJ 07042 | <a href="tel:+18628464874" style="color:#1a0dab">(862) 846-4874</a></div>
</div>
</body></html>`;
}

/** Sends the certificate. Throws with a short reason on failure; the caller records it. */
export async function sendGiftCardEmail(d: GiftCardEmailData): Promise<{ messageId: string }> {
    const user = process.env.GIFTCARD_SMTP_USER?.trim();
    const pass = process.env.GIFTCARD_SMTP_PASS?.replace(/\s+/g, '');
    if (!user || !pass) throw new Error('GIFTCARD_SMTP_USER / GIFTCARD_SMTP_PASS not set');

    const logo = await readFile(LOGO_PATH);

    const transport = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
    });

    const info = await transport.sendMail({
        from: { name: 'Fusionista Restaurant', address: user },
        to: d.recipientEmail,
        cc: d.purchaserEmail.trim() || undefined,
        replyTo: user,
        subject: GIFTCARD_EMAIL_SUBJECT,
        text: giftCardEmailBody(d),
        html: giftCardEmailHtml(d),
        attachments: [
            {
                filename: `Fusionista_Gift_Certificate_${d.code}.pdf`,
                content: Buffer.from(d.pdf),
                contentType: 'application/pdf',
            },
            {
                filename: 'fusionista-logo.png',
                content: logo,
                contentType: 'image/png',
                cid: LOGO_CID,
                contentDisposition: 'inline',
            },
        ],
    });
    return { messageId: info.messageId };
}
