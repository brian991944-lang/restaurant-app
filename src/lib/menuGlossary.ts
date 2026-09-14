// "Words that help" — the mini glossary shown at the foot of the public menu.
// Terms are proper names and render as-is in both languages; only the
// explanation is translated.
//
// NO 'use server' and NO 'use client' directive: importable from both sides.
// (Same rule as src/lib/menuTags.ts.)

export const MENU_GLOSSARY = [
    {
        term: 'Leche de tigre',
        en: 'The citrus marinade of ceviche: lime, chile, cilantro and fish juices.',
        es: 'Jugo cítrico del ceviche: limón, ají, cilantro y el jugo del pescado. Ácido y fresco.',
    },
    {
        term: 'Ají amarillo',
        en: 'Peruvian yellow chile. Fruity and aromatic — not just heat.',
        es: 'Ají peruano dorado. Frutal y aromático, no solo picante.',
    },
    {
        term: 'Choclo / cancha',
        en: 'Choclo: large boiled kernels. Cancha: crunchy toasted corn.',
        es: 'Choclo: maíz grande hervido. Cancha/chulpe: maíz tostado crocante.',
    },
    {
        term: 'Huancaína',
        en: 'Creamy sauce of ají amarillo and fresh cheese.',
        es: 'Salsa cremosa de ají amarillo y queso fresco.',
    },
    {
        term: 'Chicha morada',
        en: 'Purple-corn drink with pineapple and cinnamon. Non-alcoholic.',
        es: 'Bebida de maíz morado con piña y canela. Sin alcohol.',
    },
    {
        term: 'Saltado / chaufa',
        en: 'Wok techniques from chifa cooking (Chinese + Peruvian).',
        es: 'Técnicas wok de la cocina chifa (China + Perú).',
    },
] as const;
