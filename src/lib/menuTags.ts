// Menu tag vocabulary — the single source of truth for MenuItem.tags.
//
// The database column is String[]; these keys are the only values that should
// ever land in it. Order here is display order wherever tags are rendered.
//
// `tone` is a semantic grouping label only in this pass — the visual rebuild
// assigns colors to tones later. Keep tones stable; they will become styling.
//
// NO 'use server' and NO 'use client' directive: this module is imported from
// both server actions and client components. Adding either directive would
// break one side of that. (See the digest-563344333 outage note in
// src/lib/reportsTab.ts for why this rule exists.)

export const MENU_TAGS = [
    { key: 'signature', en: 'Signature', es: 'Especialidad', tone: 'gold' },
    { key: 'fish', en: 'Fish', es: 'Pescado', tone: 'blue' },
    { key: 'seafood', en: 'Seafood', es: 'Mariscos', tone: 'blue' },
    { key: 'beef', en: 'Beef', es: 'Res', tone: 'earth' },
    { key: 'chicken', en: 'Chicken', es: 'Pollo', tone: 'earth' },
    { key: 'pork', en: 'Pork', es: 'Cerdo', tone: 'earth' },
    { key: 'vegetarian', en: 'Vegetarian', es: 'Vegetariano', tone: 'green' },
    { key: 'vegan', en: 'Vegan', es: 'Vegano', tone: 'green' },
    { key: 'gluten_free', en: 'Gluten free', es: 'Sin gluten', tone: 'green' },
    { key: 'light_heat', en: 'Light heat', es: 'Picante suave', tone: 'heat' },
    { key: 'medium_heat', en: 'Medium heat', es: 'Picante medio', tone: 'heat' },
    { key: 'spicy', en: 'Spicy', es: 'Picante', tone: 'heat' },
    { key: 'raw', en: 'Raw', es: 'Crudo', tone: 'neutral' },
    { key: 'shareable', en: 'Shareable', es: 'Para compartir', tone: 'neutral' },
] as const;

export type MenuTagKey = (typeof MENU_TAGS)[number]['key'];
