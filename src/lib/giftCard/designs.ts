// The gift card designs. Shared by the form (thumbnails, names) and the PDF
// renderer (artwork + where each value is written). Keys are what the
// GiftCard row stores in `occasion`.

export const GIFT_CARD_DESIGNS = ['regular-m', 'regular-f', 'birthday-m', 'birthday-f', 'anniversary', 'holiday'] as const;
export type GiftCardDesign = (typeof GIFT_CARD_DESIGNS)[number];

export const DEFAULT_DESIGN: GiftCardDesign = 'regular-m';

export function isGiftCardDesign(v: unknown): v is GiftCardDesign {
    return typeof v === 'string' && (GIFT_CARD_DESIGNS as readonly string[]).includes(v);
}

/** Public URLs (public/gift-card/). */
export const designImageUrl = (d: GiftCardDesign) => `/gift-card/${d}.jpg`;
export const designThumbUrl = (d: GiftCardDesign) => `/gift-card/${d}-thumb.jpg`;

/** The blank line a value is written on: its y and x range, in artwork pixels (1536 x 1024). */
export type LineSpec = { y: number; x0: number; x1: number };

export interface DesignGeometry {
    /** Ink colour of the labels on this design; the values match it. */
    color: [number, number, number];
    fontSize: number;
    rows: { to: LineSpec; amount: LineSpec; from: LineSpec; expires: LineSpec; code: LineSpec };
}

const NAVY: [number, number, number] = [0x16, 0x2a, 0x3e];
const BROWN: [number, number, number] = [0x4a, 0x2b, 0x1b];
const MAROON: [number, number, number] = [0x6b, 0x1a, 0x2a];

/** Measured on the 1536 x 1024 artwork. Keep in sync with public/gift-card/*.jpg. */
export const DESIGN_GEOMETRY: Record<GiftCardDesign, DesignGeometry> = {
    'regular-m': {
        color: NAVY, fontSize: 38,
        rows: {
            to: { y: 487, x0: 180, x1: 862 },
            amount: { y: 577, x0: 298, x1: 862 },
            from: { y: 667, x0: 218, x1: 862 },
            expires: { y: 757, x0: 272, x1: 862 },
            code: { y: 847, x0: 240, x1: 808 },
        },
    },
    'regular-f': {
        color: NAVY, fontSize: 38,
        rows: {
            to: { y: 552, x0: 655, x1: 1413 },
            amount: { y: 628, x0: 765, x1: 1418 },
            from: { y: 710, x0: 690, x1: 1418 },
            expires: { y: 793, x0: 745, x1: 1418 },
            code: { y: 878, x0: 695, x1: 1324 },
        },
    },
    'birthday-m': {
        color: NAVY, fontSize: 38,
        rows: {
            to: { y: 569, x0: 672, x1: 1441 },
            amount: { y: 639, x0: 800, x1: 1441 },
            from: { y: 710, x0: 732, x1: 1402 },
            expires: { y: 780, x0: 770, x1: 1280 },
            code: { y: 850, x0: 720, x1: 1249 },
        },
    },
    'birthday-f': {
        color: NAVY, fontSize: 38,
        rows: {
            to: { y: 532, x0: 720, x1: 1331 },
            amount: { y: 612, x0: 830, x1: 1411 },
            from: { y: 690, x0: 768, x1: 1411 },
            expires: { y: 769, x0: 811, x1: 1324 },
            code: { y: 844, x0: 768, x1: 1290 },
        },
    },
    anniversary: {
        color: MAROON, fontSize: 38,
        rows: {
            to: { y: 538, x0: 780, x1: 1442 },
            from: { y: 603, x0: 780, x1: 1442 },
            amount: { y: 668, x0: 840, x1: 1442 },
            expires: { y: 732, x0: 825, x1: 1442 },
            code: { y: 795, x0: 805, x1: 1442 },
        },
    },
    holiday: {
        color: BROWN, fontSize: 38,
        rows: {
            to: { y: 523, x0: 660, x1: 1430 },
            amount: { y: 598, x0: 750, x1: 1433 },
            from: { y: 673, x0: 693, x1: 1286 },
            expires: { y: 756, x0: 714, x1: 1152 },
            code: { y: 828, x0: 680, x1: 1030 },
        },
    },
};
