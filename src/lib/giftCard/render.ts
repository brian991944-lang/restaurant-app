// Gift card PDF — the chosen design (public/gift-card/<design>.jpg, a
// 1536 x 1024 image with the labels and blank lines already drawn) with the
// five values written on their lines in Belleza, in the design's ink colour.
// One landscape page, the size of the artwork.
//
// Server only (reads the assets from disk). Geometry lives in designs.ts, in
// artwork pixels with the origin top-left; pdf-lib's origin is bottom-left,
// converted in `write`.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DESIGN_GEOMETRY, type GiftCardDesign, type LineSpec } from './designs';

export interface GiftCardArt {
    design: GiftCardDesign;
    /** Written after "To:"; empty writes nothing. */
    to: string;
    /** Written after "A gift of:", already formatted ("$150.00"). */
    amount: string;
    /** Written after "From:"; empty writes nothing. */
    from: string;
    /** Written after "Expires:", MM/DD/YYYY. */
    expires: string;
    code: string;
}

const W = 1536;
const H = 1024;

/** Gap between the text and the ends of its line. */
const LINE_PAD = 14;
/** The baseline sits this far above the line. */
const LINE_RISE = 9;
const MIN_SIZE = 16;

const FONT_PATH = path.join(process.cwd(), 'src', 'lib', 'giftCard', 'assets', 'Belleza-Regular.ttf');
const artPath = (design: GiftCardDesign) => path.join(process.cwd(), 'public', 'gift-card', `${design}.jpg`);

export async function renderGiftCardPdf(data: GiftCardArt): Promise<Uint8Array> {
    const geo = DESIGN_GEOMETRY[data.design];
    const [fontBytes, artBytes] = await Promise.all([readFile(FONT_PATH), readFile(artPath(data.design))]);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const art = await pdf.embedJpg(artBytes);
    const page = pdf.addPage([W, H]);
    page.drawImage(art, { x: 0, y: 0, width: W, height: H });

    const color = rgb(geo.color[0] / 255, geo.color[1] / 255, geo.color[2] / 255);
    const write = (text: string, line: LineSpec) => {
        const clean = text.trim();
        if (!clean) return;
        const maxW = line.x1 - line.x0 - 2 * LINE_PAD;
        let size = geo.fontSize;
        let w = widthOf(font, clean, size);
        while (w > maxW && size > MIN_SIZE) {
            size -= 1;
            w = widthOf(font, clean, size);
        }
        const cx = (line.x0 + line.x1) / 2;
        page.drawText(clean, { x: cx - w / 2, y: H - (line.y - LINE_RISE), size, font, color });
    };

    write(data.to, geo.rows.to);
    write(data.amount, geo.rows.amount);
    write(data.from, geo.rows.from);
    write(data.expires, geo.rows.expires);
    write(data.code, geo.rows.code);

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
