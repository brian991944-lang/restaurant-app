// Menu tag vocabulary — the single source of truth for MenuItem.tags.
//
// The database column is String[]; these keys are the only values that should
// ever land in it. Order here is display order wherever tags are rendered.
//
// This vocabulary REPLACED a larger 14-key draft (signature/seafood/... —
// commit c1b4e36) after the external design intake settled on six. The swap
// was verified safe: no MenuItem row carried a tag at the time. If a key is
// ever renamed again, migrate stored rows first — old keys do not error, they
// just silently stop matching anything.
//
// NO 'use server' and NO 'use client' directive: this module is imported from
// both server actions and client components. Adding either directive would
// break one side of that. (See the digest-563344333 outage note in
// src/lib/reportsTab.ts for why this rule exists.)

export const MENU_TAGS = [
    { key: 'sig', en: 'Signature', es: 'Firma' },
    { key: 'fish', en: 'Fish', es: 'Pescado' },
    { key: 'shell', en: 'Shellfish', es: 'Mariscos' },
    { key: 'nut', en: 'Nuts', es: 'Frutos secos' },
    { key: 'spice', en: 'Light heat', es: 'Toque picante' },
    { key: 'veg', en: 'Vegetarian', es: 'Vegetariano' },
] as const;

export type MenuTagKey = (typeof MENU_TAGS)[number]['key'];
