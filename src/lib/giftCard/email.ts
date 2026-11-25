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

/** Sends the certificate. Throws with a short reason on failure; the caller records it. */
export async function sendGiftCardEmail(d: GiftCardEmailData): Promise<{ messageId: string }> {
    const user = process.env.GIFTCARD_SMTP_USER?.trim();
    const pass = process.env.GIFTCARD_SMTP_PASS?.replace(/\s+/g, '');
    if (!user || !pass) throw new Error('GIFTCARD_SMTP_USER / GIFTCARD_SMTP_PASS not set');

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
        attachments: [{
            filename: `Fusionista_Gift_Certificate_${d.code}.pdf`,
            content: Buffer.from(d.pdf),
            contentType: 'application/pdf',
        }],
    });
    return { messageId: info.messageId };
}
