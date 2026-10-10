/**
 * What the Analytics Sync button gets back, one block per source. Declared
 * here because a 'use server' module may export only actions.
 */

import type { SkippedCode } from '@/lib/pos/toastDailySales';

export type SyncAnalyticsResult = {
    success: boolean;
    code?: 'NOT_ADMIN';
    /** Today's Toast business date, once the action ran. */
    today?: string;
    toast: {
        /** Days whose figures and items were rewritten. */
        read: string[];
        /** Days Toast would not give, with the reason the UI translates. */
        skipped: { date: string; code: SkippedCode; status?: number }[];
        /** Days since go-live still owed after this run; another press reads the next ones. */
        remaining: number;
        error: 'FAILED' | null;
    };
    google: {
        ran: boolean;
        /** Reviews written or refreshed this run. */
        reviews: number;
        /** Days of profile metrics refreshed (0 when the step did not run). */
        metricDays: number;
        error: 'NOT_CONNECTED' | 'FAILED' | 'TIME' | null;
    };
    clover: {
        ran: boolean;
        /** Line items processed for the Clover audit. */
        items: number;
        error: 'FAILED' | 'TIME' | null;
    };
    tookMs: number;
};
