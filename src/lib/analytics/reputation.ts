/**
 * What the Reputación dashboard says about a window of Google reviews and
 * Business Profile metrics (GbpReview, GbpDailyMetric, GbpRatingSnapshot —
 * synced daily by /api/gbp/sync).
 *
 * Pure functions, no directive. The themes are keyword tallies, not
 * sentiment analysis: a review "mentions" a theme when its text contains one
 * of the theme's words, and the review's own star rating says whether the
 * mention came with a complaint (3 stars or fewer). That is the honest
 * version of "what do reviews talk about" without a model in the loop.
 */

export type ReviewLite = {
    id: string;
    /** 'YYYY-MM-DD', the New York calendar day the review was posted. */
    date: string;
    createdAt: string;
    stars: number;
    reviewer: string | null;
    comment: string | null;
    replied: boolean;
};

export type ReviewSummary = {
    count: number;
    /** Mean star rating to one decimal; null without a review. */
    avgStars: number | null;
    /** Index 1..5 = how many reviews gave that many stars (index 0 unused). */
    byStar: number[];
    withComment: number;
    unanswered: number;
    /** The oldest unanswered review's date, when there is one. */
    oldestUnanswered: string | null;
    /** Replied ÷ count, as a whole percent; null without a review. */
    responseRate: number | null;
};

export function summarizeReviews(reviews: ReviewLite[]): ReviewSummary {
    const byStar = [0, 0, 0, 0, 0, 0];
    let sum = 0, withComment = 0, unanswered = 0, replied = 0;
    let oldestUnanswered: string | null = null;
    for (const r of reviews) {
        if (r.stars >= 1 && r.stars <= 5) byStar[r.stars] += 1;
        sum += r.stars;
        if (r.comment && r.comment.trim().length > 0) withComment += 1;
        if (r.replied) replied += 1;
        else {
            unanswered += 1;
            if (oldestUnanswered === null || r.date < oldestUnanswered) oldestUnanswered = r.date;
        }
    }
    const count = reviews.length;
    return {
        count,
        avgStars: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
        byStar,
        withComment,
        unanswered,
        oldestUnanswered,
        responseRate: count > 0 ? Math.round((replied / count) * 100) : null
    };
}

export type ReviewDay = { date: string; five: number; four: number; lowOrLess: number };

/** Reviews per day in three buckets — 5 stars, 4 stars, 3 or fewer — for every date of the window. */
export function reviewsPerDay(reviews: ReviewLite[], dates: string[]): ReviewDay[] {
    const byDate = new Map(dates.map(d => [d, { date: d, five: 0, four: 0, lowOrLess: 0 }]));
    for (const r of reviews) {
        const day = byDate.get(r.date);
        if (!day) continue;
        if (r.stars >= 5) day.five += 1; else if (r.stars === 4) day.four += 1; else day.lowOrLess += 1;
    }
    return dates.map(d => byDate.get(d)!);
}

/** Lowercase, accents stripped, so "atención" matches "atencion" and "Ají" matches "aji". */
export const normalizeText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type ThemeKey = 'food' | 'service' | 'wait' | 'price' | 'ambiance' | 'portions';

/** The words that place a review under a theme, in both languages the reviews come in. */
export const THEME_WORDS: Record<ThemeKey, string[]> = {
    food: ['delicio', 'sabor', 'sabros', 'rico', 'riqu', 'flavor', 'flavour', 'tasty', 'yummy', 'fresh', 'fresc', 'exquisit', 'bland', 'insipid', 'salad', 'seasoned', 'cold food', 'comida fria'],
    service: ['servicio', 'atenci', 'amable', 'service', 'staff', 'server', 'waiter', 'waitress', 'attentive', 'friendly', 'hospitality', 'mesero', 'mesera', 'rude', 'grosero'],
    wait: ['espera', 'esperamos', 'esperar', 'tardar', 'tardo', 'demor', 'wait', 'waited', 'slow', 'took forever', 'long time', 'lento'],
    price: ['precio', 'caro', 'barato', 'cost', 'price', 'pricey', 'expensive', 'overpriced', 'worth', 'value', 'vale la pena'],
    ambiance: ['ambiente', 'musica', 'music', 'decor', 'cozy', 'acogedor', 'loud', 'noisy', 'ruido', 'atmosphere', 'vibe', 'romantic', 'romantico', 'patio', 'outdoor'],
    portions: ['porci', 'portion', 'generous', 'generos', 'huge', 'small plate', 'pequen', 'abundante', 'filling']
};

export type ThemeCount = { theme: ThemeKey; mentions: number; lowStarMentions: number };

/** How many reviews mention each theme, and how many of those gave 3 stars or fewer. Themes with no mention are left out. */
export function reviewThemes(reviews: ReviewLite[]): ThemeCount[] {
    const counts = new Map<ThemeKey, ThemeCount>();
    for (const r of reviews) {
        if (!r.comment) continue;
        const text = normalizeText(r.comment);
        for (const theme of Object.keys(THEME_WORDS) as ThemeKey[]) {
            if (!THEME_WORDS[theme].some(w => text.includes(w))) continue;
            const c = counts.get(theme) ?? { theme, mentions: 0, lowStarMentions: 0 };
            c.mentions += 1;
            if (r.stars <= 3) c.lowStarMentions += 1;
            counts.set(theme, c);
        }
    }
    return [...counts.values()].sort((a, b) => b.mentions - a.mentions);
}

/** Dish names reviews tend to call out, with the word that catches them. */
export const DISH_WORDS: { name: string; words: string[] }[] = [
    { name: 'Ceviche', words: ['ceviche', 'cebiche'] },
    { name: 'Lomo saltado', words: ['lomo'] },
    { name: 'Ají de gallina', words: ['aji de gallina', 'gallina'] },
    { name: 'Arroz chaufa', words: ['chaufa'] },
    { name: 'Anticuchos', words: ['anticucho'] },
    { name: 'Causa', words: ['causa limena', 'causa '] },
    { name: 'Tacu tacu', words: ['tacu'] },
    { name: 'Pisco sour', words: ['pisco'] },
    { name: 'Chicha morada', words: ['chicha'] },
    { name: 'Papa a la huancaína', words: ['huancaina'] },
    { name: 'Tallarín saltado', words: ['tallarin'] },
    { name: 'Jalea', words: ['jalea'] },
    { name: 'Pescado a lo macho', words: ['a lo macho'] },
    { name: 'Seco', words: ['seco de'] },
    { name: 'Tiradito', words: ['tiradito'] },
    { name: 'Leche de tigre', words: ['leche de tigre'] },
    { name: 'Picarones', words: ['picaron'] },
    { name: 'Suspiro limeño', words: ['suspiro'] },
    { name: 'Alfajores', words: ['alfajor'] },
    { name: 'Lúcuma', words: ['lucuma'] },
    { name: 'Empanadas', words: ['empanada'] },
    { name: 'Rotisserie chicken', words: ['pollo a la brasa', 'rotisserie'] }
];

export type DishMention = { name: string; mentions: number; avgStars: number };

/** Which dishes the window's reviews name, most mentioned first, with the mean rating of the reviews that name them. */
export function dishMentions(reviews: ReviewLite[]): DishMention[] {
    const counts = new Map<string, { mentions: number; stars: number }>();
    for (const r of reviews) {
        if (!r.comment) continue;
        const text = normalizeText(r.comment);
        for (const dish of DISH_WORDS) {
            if (!dish.words.some(w => text.includes(w))) continue;
            const c = counts.get(dish.name) ?? { mentions: 0, stars: 0 };
            c.mentions += 1;
            c.stars += r.stars;
            counts.set(dish.name, c);
        }
    }
    return [...counts.entries()]
        .map(([name, c]) => ({ name, mentions: c.mentions, avgStars: Math.round((c.stars / c.mentions) * 10) / 10 }))
        .sort((a, b) => b.mentions - a.mentions);
}

/** One day of Business Profile performance, the metrics folded into what the owner acts on. */
export type MetricDay = {
    date: string;
    /** Search + Maps, mobile + desktop. */
    impressions: number;
    searchImpressions: number;
    mapsImpressions: number;
    directions: number;
    calls: number;
    website: number;
    menu: number;
    bookings: number;
};

export const emptyMetricDay = (date: string): MetricDay => ({ date, impressions: 0, searchImpressions: 0, mapsImpressions: 0, directions: 0, calls: 0, website: 0, menu: 0, bookings: 0 });

/** Fold the raw (date, metric, value) rows into one MetricDay per date of the window. Days Google has not reported yet stay null. */
export function foldMetrics(rows: { date: string; metric: string; value: number }[], dates: string[]): (MetricDay | null)[] {
    const byDate = new Map<string, MetricDay>();
    for (const r of rows) {
        const day = byDate.get(r.date) ?? emptyMetricDay(r.date);
        switch (r.metric) {
            case 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH':
            case 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH': day.searchImpressions += r.value; day.impressions += r.value; break;
            case 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS':
            case 'BUSINESS_IMPRESSIONS_MOBILE_MAPS': day.mapsImpressions += r.value; day.impressions += r.value; break;
            case 'BUSINESS_DIRECTION_REQUESTS': day.directions += r.value; break;
            case 'CALL_CLICKS': day.calls += r.value; break;
            case 'WEBSITE_CLICKS': day.website += r.value; break;
            case 'BUSINESS_FOOD_MENU_CLICKS': day.menu += r.value; break;
            case 'BUSINESS_BOOKINGS': day.bookings += r.value; break;
            default: break; // conversations and food orders: always zero for this profile
        }
        byDate.set(r.date, day);
    }
    return dates.map(d => byDate.get(d) ?? null);
}

export type MetricTotals = Omit<MetricDay, 'date'> & { days: number; actions: number };

export function sumMetrics(days: (MetricDay | null)[]): MetricTotals {
    const t: MetricTotals = { impressions: 0, searchImpressions: 0, mapsImpressions: 0, directions: 0, calls: 0, website: 0, menu: 0, bookings: 0, days: 0, actions: 0 };
    for (const d of days) {
        if (!d) continue;
        t.days += 1;
        t.impressions += d.impressions; t.searchImpressions += d.searchImpressions; t.mapsImpressions += d.mapsImpressions;
        t.directions += d.directions; t.calls += d.calls; t.website += d.website; t.menu += d.menu; t.bookings += d.bookings;
    }
    t.actions = t.directions + t.calls + t.website + t.menu + t.bookings;
    return t;
}

/** What actions/analytics.ts answers for the Reputación dashboard. Declared here because a 'use server' module may export only actions. */
export type AnalyticsReputationResult = {
    success: boolean;
    error?: string;
    code?: 'NOT_ADMIN' | 'BAD_DATE' | 'READ_FAILED';
    today: string;
    range: { from: string; to: string };
    /** The profile's headline as of the latest snapshot; null before the first sync. */
    headline: { rating: number; total: number; date: string } | null;
    summary: ReviewSummary;
    /** The same-length window before this one — Google history reaches back years, so it always exists. */
    previous: { summary: ReviewSummary; metrics: MetricTotals };
    perDay: ReviewDay[];
    themes: ThemeCount[];
    dishes: DishMention[];
    /** The window's newest reviews with their text, newest first, capped. */
    latest: ReviewLite[];
    metrics: (MetricDay | null)[];
    metricTotals: MetricTotals;
    /** The last date Google has reported performance for; its figures lag two or three days. */
    lastMetricDate: string | null;
};
