// Etiquetas — builds the label as an exact-size PDF (29 x 62 mm per page, label turned sideways).
//
// Why a PDF: printing a web page from an iPad ignores the page size the page
// asks for, keeps wide margins, and stamps the URL, date and page number on
// the paper. A PDF handed to the iPad's own print sheet carries none of that.
// The label is drawn on a canvas at printer resolution and wrapped in a
// minimal hand-written PDF, so there is no dependency to install.
//
// Browser only (uses <canvas>).

export interface LabelPdfData {
    /** Product name, printed large (up to two lines). */
    main: string;
    /** Smaller line under the name, or null. */
    sub: string | null;
    /** Optional quantity, boxed next to the name. Empty prints nothing. */
    quantity: string;
    madeLabel: string;
    madeValue: string;
    expiresLabel: string;
    expiresValue: string;
    storage: string;
    cooks: string;
}

export const LABEL_H_MM = 29;
/**
 * Label lengths the app can print, matching the printer's own paper sizes:
 * 62 = "29 x 62 mm" (continuous roll, cut at 62) · 90 = "29 x 90 mm" (pre-cut address labels).
 */
export const LABEL_LENGTHS_MM = [62, 90] as const;
export type LabelLengthMm = (typeof LABEL_LENGTHS_MM)[number];

const DPI = 600;
const MM = DPI / 25.4;          // canvas px per mm
const PT = DPI / 72;            // canvas px per typographic point
const FONT = 'Arial, Helvetica, sans-serif';

// The printer cannot reach the outer ~2 mm of a 62 mm roll.
const PAD_X = 3 * MM;
const PAD_Y = 1.6 * MM;

const font = (pt: number, bold: boolean) => `${bold ? '800' : '400'} ${pt * PT}px ${FONT}`;

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
}

/** Greedy word wrap into at most two lines; the second is cut with an ellipsis. */
function wrapTwo(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    let first = '';
    let i = 0;
    for (; i < words.length; i++) {
        const next = first ? `${first} ${words[i]}` : words[i];
        if (first && ctx.measureText(next).width > maxWidth) break;
        first = next;
    }
    if (i >= words.length) return [fit(ctx, first, maxWidth)];
    return [fit(ctx, first, maxWidth), fit(ctx, words.slice(i).join(' '), maxWidth)];
}

function drawLabel(data: LabelPdfData, lengthMm: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(lengthMm * MM);
    canvas.height = Math.round(LABEL_H_MM * MM);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');

    const W = canvas.width;
    const H = canvas.height;
    const left = PAD_X;
    const right = W - PAD_X;
    const inner = right - left;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';

    // Sizes (pt) and the height each block takes (px).
    const NAME_PT = 11, SUB_PT = 6.5, ROW_PT = 7, ROW_B_PT = 8, EXP_PT = 7, EXP_B_PT = 11, FOOT_PT = 6.5, QTY_PT = 8.5;
    const lineH = (pt: number) => pt * PT * 1.14;

    // Quantity box (measured first: it narrows the room for the name).
    const qty = data.quantity.trim();
    let qtyW = 0;
    let qtyText = '';
    const qtyPadX = 1.2 * MM;
    if (qty) {
        ctx.font = font(QTY_PT, true);
        qtyText = fit(ctx, qty, 22 * MM);
        qtyW = ctx.measureText(qtyText).width + qtyPadX * 2;
    }

    ctx.font = font(NAME_PT, true);
    const nameMax = inner - (qtyW ? qtyW + 2 * MM : 0);
    const nameLines = wrapTwo(ctx, data.main.toUpperCase(), nameMax);

    const nameH = nameLines.length * lineH(NAME_PT);
    const subH = data.sub ? lineH(SUB_PT) : 0;
    const rowH = lineH(ROW_B_PT);
    const barH = lineH(EXP_B_PT) + 1.2 * MM;
    const footH = lineH(FOOT_PT);
    const blocks = nameH + subH + rowH + barH + footH;
    const gap = Math.max((H - PAD_Y * 2 - blocks) / 3, 0.4 * MM);

    let y = PAD_Y;

    // Name (+ quantity box on the first line)
    ctx.font = font(NAME_PT, true);
    nameLines.forEach((line, idx) => {
        ctx.textAlign = 'left';
        ctx.fillText(line, left, y + lineH(NAME_PT) * (idx + 1) - NAME_PT * PT * 0.26);
    });
    if (qtyText) {
        const boxH = lineH(QTY_PT) + 0.6 * MM;
        const bx = right - qtyW;
        const by = y + 0.1 * MM;
        ctx.lineWidth = 0.4 * MM;
        ctx.strokeRect(bx + ctx.lineWidth / 2, by + ctx.lineWidth / 2, qtyW - ctx.lineWidth, boxH - ctx.lineWidth);
        ctx.font = font(QTY_PT, true);
        ctx.textAlign = 'center';
        ctx.fillText(qtyText, bx + qtyW / 2, by + boxH - (boxH - QTY_PT * PT * 0.72) / 2);
    }
    y += nameH;

    if (data.sub) {
        ctx.font = font(SUB_PT, true);
        ctx.textAlign = 'left';
        ctx.fillText(fit(ctx, data.sub, inner), left, y + lineH(SUB_PT) - SUB_PT * PT * 0.26);
        y += subH;
    }
    y += gap;

    // Hecho
    ctx.font = font(ROW_PT, false);
    ctx.textAlign = 'left';
    const madeLabelW = ctx.measureText(data.madeLabel).width;
    ctx.fillText(data.madeLabel, left, y + rowH - ROW_B_PT * PT * 0.26);
    ctx.font = font(ROW_B_PT, true);
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, data.madeValue, inner - madeLabelW - 2 * MM), right, y + rowH - ROW_B_PT * PT * 0.26);
    y += rowH + gap;

    // Vence (black bar)
    ctx.fillRect(left, y, inner, barH);
    ctx.fillStyle = '#fff';
    const barBase = y + barH - (barH - EXP_B_PT * PT * 0.72) / 2;
    ctx.font = font(EXP_PT, true);
    ctx.textAlign = 'left';
    const expLabelW = ctx.measureText(data.expiresLabel).width;
    ctx.fillText(data.expiresLabel, left + 2 * MM, barBase);
    ctx.font = font(EXP_B_PT, true);
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, data.expiresValue.toUpperCase(), inner - expLabelW - 6 * MM), right - 2 * MM, barBase);
    ctx.fillStyle = '#000';
    y += barH + gap;

    // Storage + cooks
    ctx.font = font(FOOT_PT, true);
    ctx.textAlign = 'left';
    const storage = data.storage.toUpperCase();
    const storageW = ctx.measureText(storage).width;
    ctx.fillText(storage, left, y + footH - FOOT_PT * PT * 0.26);
    if (data.cooks) {
        ctx.textAlign = 'right';
        ctx.fillText(fit(ctx, data.cooks.toUpperCase(), inner - storageW - 3 * MM), right, y + footH - FOOT_PT * PT * 0.26);
    }

    return canvas;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** One page per copy, every page the same label. Synchronous on purpose: the iPad only allows sharing straight from a tap. */
export function buildLabelPdf(data: LabelPdfData, copies: number, lengthMm: LabelLengthMm = 62): Uint8Array {
    const canvas = drawLabel(data, lengthMm);
    const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 1));
    const n = Math.max(1, Math.floor(copies));

    const wPt = (lengthMm / 25.4) * 72;
    const hPt = (LABEL_H_MM / 25.4) * 72;
    // The printer's AirPrint sizes for these labels are "29 x 62 mm" and
    // "29 x 90 mm": 29 mm across the roll, the length along the feed. The page is laid out that way (label
    // turned a quarter turn) so the iPad picks that size by itself; a 62 x 29
    // page made it choose 58 x 58 and leave white bands.
    const box = `[0 0 ${hPt.toFixed(2)} ${wPt.toFixed(2)}]`;

    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (part: string | Uint8Array) => {
        const bytes = typeof part === 'string' ? enc.encode(part) : part;
        chunks.push(bytes);
        length += bytes.length;
    };
    const obj = (id: number, body: string) => { offsets[id] = length; push(`${id} 0 obj\n${body}\nendobj\n`); };

    // 1 catalog · 2 pages · 3 image · 4 page content · 5.. one page object per copy
    const firstPage = 5;
    const kids = Array.from({ length: n }, (_, i) => `${firstPage + i} 0 R`).join(' ');
    const content = `q 0 ${wPt.toFixed(2)} ${(-hPt).toFixed(2)} 0 ${hPt.toFixed(2)} 0 cm /Im0 Do Q`;

    push('%PDF-1.4\n%âãÏÓ\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    offsets[3] = length;
    push(`3 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream\nendobj\n');
    obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    for (let i = 0; i < n; i++) {
        obj(firstPage + i, `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources << /XObject << /Im0 3 0 R >> >> /Contents 4 0 R >>`);
    }

    const total = firstPage + n;
    const xrefAt = length;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

/** iPhone / iPad (iPadOS reports itself as a Mac, so touch points tell them apart). */
export function isAppleTouchDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
