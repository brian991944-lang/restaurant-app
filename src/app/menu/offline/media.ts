/**
 * Which stored copy of a dish photo a given launch uses.
 *
 * Every menu photo is uploaded once and stored twice (see ImageUpload and the
 * MenuItem model): a web copy at 1200 px for guests on their phones, and a
 * full copy at 2400 px for the installed iPads, which are on the house wifi
 * and have the screen to justify it. photoUrl / photoUrls hold the web copy;
 * photoUrlFull / photoUrlsFull hold its twin, null or short for any photo
 * uploaded before the split — those fall back to the web URL.
 *
 * Both the renderer (MenuClient) and the offline media warm-up (sync.ts) ask
 * this module, and that is the point: if they resolved the pair separately
 * they could drift, and an iPad that caches one copy while displaying the
 * other downloads BOTH — exactly what the two variants exist to avoid.
 */
import type { MenuItemData, OfflineSnapshot } from './types';

export type MediaVariant = 'web' | 'full';

/** A photo and its full-res twin; `full` falls back to `web` when there is none. */
export type PhotoPair = { web: string; full: string };

/** Cover first, then the gallery, deduped on the web URL (the stable identity). */
export function photoPairs(item: MenuItemData): PhotoPair[] {
    const pairs: PhotoPair[] = [];
    const seen = new Set<string>();
    const push = (web: string | null | undefined, full: string | null | undefined) => {
        if (!web || seen.has(web)) return;
        seen.add(web);
        pairs.push({ web, full: full || web });
    };
    push(item.photoUrl, item.photoUrlFull);
    // photoUrlsFull is index-aligned with photoUrls; a missing entry is a photo
    // from before the split and resolves to the web copy.
    const fulls = item.photoUrlsFull || [];
    (item.photoUrls || []).forEach((url, i) => push(url, fulls[i]));
    return pairs;
}

export function pick(pair: PhotoPair, variant: MediaVariant): string {
    return variant === 'full' ? pair.full : pair.web;
}

/** Lightbox gallery URLs for this variant, cover first. */
export function photosOf(item: MenuItemData, variant: MediaVariant): string[] {
    return photoPairs(item).map(p => pick(p, variant));
}

/** Card cover for this variant: the cover photo, else the first gallery photo. */
export function coverOf(item: MenuItemData, variant: MediaVariant): string | null {
    const first = photoPairs(item)[0];
    return first ? pick(first, variant) : null;
}

/** True when the item has anything to open a lightbox for. Variant-independent. */
export function hasMedia(item: MenuItemData): boolean {
    return photoPairs(item).length > 0 || !!item.videoUrl;
}

/**
 * Every media URL a launch of this variant will actually request — what the
 * media cache warms, and (by omission) what it evicts. Video has one encode,
 * so it is in both variants' sets.
 */
export function mediaUrlsOf(snapshot: OfflineSnapshot | null, variant: MediaVariant): Set<string> {
    const urls = new Set<string>();
    if (!snapshot) return urls;
    for (const item of snapshot.items) {
        for (const url of photosOf(item, variant)) urls.add(url);
        if (item.videoUrl) urls.add(item.videoUrl);
    }
    return urls;
}
