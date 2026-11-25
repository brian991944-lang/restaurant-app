// Gift card PDF — draws the per-card values over the restaurant's card
// artwork. The artwork (assets/base.jpg) is the Canva design with every
// fixed element baked in: banner, logo, llama panel, row labels and rules.
// Only the five values and the occasion line are drawn here, in the same
// font (Belleza) and at the same positions as the Canva template, so a card
// made by the app is indistinguishable from one made by hand.
//
// Server only (reads the assets from disk). Geometry is in Canva page pixels
// (1110 x 1600, origin top-left); pdf-lib's origin is bottom-left, converted
// in `drawCentered`.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface GiftCardArt {
    /** Printed after "To:"; empty prints nothing. */
    to: string;
    /** Printed after "A gift of:", already formatted ("$150.00"). */
    amount: string;
    /** Printed after "From:"; empty prints nothing. */
    from: string;
    /** Printed after "Expires:", MM/DD/YYYY. */
    expires: string;
    code: string;
    /** Panel text, e.g. "Happy Birthday!"; wraps on "\n". Empty prints nothing. */
    occasion: string;
}

const W = 1110;
const H = 1600;

/** Center x of the value column. */
const VALUE_CX = 449;
/** Widest a value may be before its size shrinks. */
const VALUE_MAX_W = 460;
const VALUE_SIZE = 44;
/** Top of each value's text box, from the Canva template. */
const ROW_TOP = { to: 1102, amount: 1189, from: 1286, expires: 1391, code: 1485 } as const;

const OCCASION_CX = 912;
const OCCASION_TOP = 1332;
const OCCASION_SIZE = 68;
const OCCASION_MAX_W = 330;
const OCCASION_LINE_H = 1.4;
const OCCASION_COLOR = rgb(0xe8 / 255, 0xd4 / 255, 0xc0 / 255);

const ASSETS = path.join(process.cwd(), 'src', 'lib', 'giftCard', 'assets');

export async function renderGiftCardPdf(data: GiftCardArt): Promise<Uint8Array> {
    const [fontBytes, baseBytes] = await Promise.all([
        readFile(path.join(ASSETS, 'Belleza-Regular.ttf')),
        readFile(path.join(ASSETS, 'base.jpg')),
    ]);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const base = await pdf.embedJpg(baseBytes);
    const page = pdf.addPage([W, H]);
    page.drawImage(base, { x: 0, y: 0, width: W, height: H });

    const black = rgb(0, 0, 0);
    const drawCentered = (text: string, cx: number, top: number, size: number, color: ReturnType<typeof rgb>, maxW: number) => {
        const clean = text.trim();
        if (!clean) return;
        let s = size;
        let w = widthOf(font, clean, s);
        while (w > maxW && s > 18) {
            s -= 1;
            w = widthOf(font, clean, s);
        }
        // Belleza's cap height sits about 0.95 em below the top of its box.
        const baseline = H - (top + s * 0.95);
        page.drawText(clean, { x: cx - w / 2, y: baseline, size: s, font, color });
    };

    drawCentered(data.to, VALUE_CX, ROW_TOP.to, VALUE_SIZE, black, VALUE_MAX_W);
    drawCentered(data.amount, VALUE_CX, ROW_TOP.amount, VALUE_SIZE, black, VALUE_MAX_W);
    drawCentered(data.from, VALUE_CX, ROW_TOP.from, VALUE_SIZE, black, VALUE_MAX_W);
    drawCentered(data.expires, VALUE_CX, ROW_TOP.expires, VALUE_SIZE, black, VALUE_MAX_W);
    drawCentered(data.code, VALUE_CX, ROW_TOP.code, VALUE_SIZE, black, VALUE_MAX_W);

    const lines = data.occasion.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
    lines.forEach((line, i) => {
        drawCentered(line, OCCASION_CX, OCCASION_TOP + i * OCCASION_SIZE * OCCASION_LINE_H, OCCASION_SIZE, OCCASION_COLOR, OCCASION_MAX_W);
    });

    pdf.setTitle('Fusionista Gift Certificate');
    pdf.setAuthor('Fusionista, Modern Peruvian Cuisine');
    return pdf.save();
}

/** Width of `text`, with any glyph the font lacks counted as a space. */
function widthOf(font: PDFFont, text: string, size: number): number {
    try {
        return font.widthOfTextAtSize(text, size);
    } catch {
        return font.widthOfTextAtSize(text.replace(/[^\x20-\x7E¡-ÿ]/g, ' '), size);
    }
}

/**
 * The occasion line as printed on the card: two words become two lines so
 * "Happy Birthday!" stacks the way the Canva card does. Longer texts wrap by
 * width in the renderer.
 */
export function occasionLines(text: string): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 2) return `${words[0]}\n${words[1]}`;
    if (words.length === 3) return `${words[0]} ${words[1]}\n${words[2]}`;
    return words.join(' ');
}
