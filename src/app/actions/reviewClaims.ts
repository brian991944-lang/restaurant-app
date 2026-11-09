'use server';

/**
 * Review claims: servers claim the day's reviews, points go on a monthly
 * leaderboard, and low reviews go to management.
 *
 * Rules (defaults, all in one place):
 *  - Google reviews come from GbpReview (already synced daily by /api/gbp/sync
 *    and on page open by autoSync). Yelp/Resy/OpenTable are entered by hand
 *    with the review's link, because none of them offers a feed we can use.
 *  - A review can be claimed by one person. To claim it you must be on a tip
 *    sheet for the review's business day or one of the CLAIM_LOOKBACK_DAYS
 *    days before it (guests often post the next day).
 *  - Google claim where the guest named the claimant → approved on the spot.
 *    Everything else waits for a manager.
 *  - Points are the same for any star rating. Points only for 5 stars would
 *    push staff to ask guests for 5 stars, which Google's review policy treats
 *    as rating manipulation and can get reviews removed.
 *  - LOW_REVIEW_MAX_STARS or fewer, any source → management follow-up queue.
 */

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ReviewSource } from '@prisma/client';
import { isAdminSession } from '@/lib/adminGuard';
import { getBusinessDate, getBusinessDayWindowUtc, businessDateToUtcDate } from '@/lib/businessDay';
import { getTipEligibleStaff } from '@/app/actions/clover';
import { matchServers, type ServerMatch } from '@/lib/gbp/serverMatch';
import { LOW_REVIEW_MAX_STARS } from '@/lib/gbp/reviewRules';

const ROUTE = '/[locale]/tips-reviews';
const CLAIM_LOOKBACK_DAYS = 2;
/** Fallback if a ReviewPointsRule row is missing. Matches the migration seed. */
const DEFAULT_POINTS: Record<ReviewSource, number> = { GOOGLE: 1, YELP: 2, RESY: 3, OPENTABLE: 3 };

const addDays = (d: string, n: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
};
const monthOf = (businessDate: string) => businessDate.slice(0, 7);

/** Staff on a tip sheet for any of the given business dates. */
async function staffOnTipSheets(dates: string[]): Promise<Set<string>> {
    const rows = await prisma.tipShiftEntry.findMany({
        where: { tipShift: { tipDay: { businessDate: { in: dates.map(businessDateToUtcDate) } } } },
        select: { cloverEmployeeId: true },
    });
    return new Set(rows.map(r => r.cloverEmployeeId));
}

export type DayReview = {
    id: string;
    reviewerName: string | null;
    starRating: number;
    comment: string | null;
    createTime: string;
    suggestions: ServerMatch[];
    claim: { employeeName: string; status: string; autoApproved: boolean; points: number | null } | null;
    isLow: boolean;
};

/** The Reviews section for one business day: each Google review with its suggested server and claim. */
export async function getReviewDay(businessDate: string = getBusinessDate()): Promise<{
    reviews: DayReview[];
    error: string | null;
}> {
    try {
        const { start, end } = getBusinessDayWindowUtc(businessDate);
        const [rows, { staff }] = await Promise.all([
            prisma.gbpReview.findMany({
                where: { createTime: { gte: start, lte: end } },
                orderBy: { createTime: 'desc' },
                include: { claim: true },
            }),
            getTipEligibleStaff(),
        ]);
        return {
            error: null,
            reviews: rows.map(r => ({
                id: r.id,
                reviewerName: r.isAnonymous ? null : r.reviewerName,
                starRating: r.starRating,
                comment: r.comment,
                createTime: r.createTime.toISOString(),
                suggestions: matchServers(r.comment, staff),
                isLow: r.starRating <= LOW_REVIEW_MAX_STARS,
                claim: r.claim && {
                    employeeName: r.claim.employeeName,
                    status: r.claim.status,
                    autoApproved: r.claim.autoApproved,
                    points: r.claim.pointsAwarded,
                },
            })),
        };
    } catch (e) {
        return { reviews: [], error: `No se pudieron cargar las reseñas: ${e instanceof Error ? e.message : String(e)}` };
    }
}

async function pointsFor(source: ReviewSource): Promise<number> {
    const rule = await prisma.reviewPointsRule.findUnique({ where: { source } });
    return rule?.points ?? DEFAULT_POINTS[source];
}

/** A server claims a Google review. */
export async function claimGoogleReview(input: {
    reviewId: string;
    cloverEmployeeId: string;
    employeeName: string;
}): Promise<{ success: true; autoApproved: boolean } | { success: false; error: string }> {
    const review = await prisma.gbpReview.findUnique({ where: { id: input.reviewId }, include: { claim: true } });
    if (!review) return { success: false, error: 'Reseña no encontrada.' };
    if (review.claim) return { success: false, error: `Ya fue reclamada por ${review.claim.employeeName}.` };

    const reviewDay = getBusinessDate(review.createTime);
    const window = Array.from({ length: CLAIM_LOOKBACK_DAYS + 1 }, (_, n) => addDays(reviewDay, -n));
    const worked = await staffOnTipSheets(window);
    if (!worked.has(input.cloverEmployeeId)) {
        return { success: false, error: 'Solo puede reclamarla alguien que trabajó ese día o los dos días anteriores.' };
    }

    const { staff } = await getTipEligibleStaff();
    const suggestions = matchServers(review.comment, staff);
    const named = suggestions.some(s => s.staffId === input.cloverEmployeeId);
    const points = named ? await pointsFor('GOOGLE') : null;

    try {
        await prisma.reviewClaim.create({
            data: {
                source: 'GOOGLE',
                gbpReviewId: review.id,
                cloverEmployeeId: input.cloverEmployeeId,
                employeeName: input.employeeName,
                suggestedStaffId: suggestions[0]?.staffId ?? null,
                status: named ? 'APPROVED' : 'PENDING',
                autoApproved: named,
                pointsAwarded: points,
                decidedAt: named ? new Date() : null,
                decidedBy: named ? 'auto: nombrado en la reseña' : null,
                businessMonth: monthOf(reviewDay),
            },
        });
    } catch {
        // Unique constraint: someone claimed it a moment ago.
        return { success: false, error: 'Otra persona la reclamó primero.' };
    }
    revalidatePath(ROUTE);
    return { success: true, autoApproved: named };
}

/** A server adds a Yelp, Resy or OpenTable review by link and claims it. Always waits for a manager. */
export async function submitExternalReview(input: {
    source: Exclude<ReviewSource, 'GOOGLE'>;
    url: string;
    reviewDate: string; // business date the guest dined / posted
    reviewerName?: string;
    cloverEmployeeId: string;
    employeeName: string;
}): Promise<{ success: true } | { success: false; error: string }> {
    let url: URL;
    try { url = new URL(input.url.trim()); } catch { return { success: false, error: 'El enlace no es válido.' }; }
    const hosts: Record<string, string[]> = {
        YELP: ['yelp.com'],
        RESY: ['resy.com'],
        OPENTABLE: ['opentable.com'],
    };
    const okHost = hosts[input.source].some(h => url.hostname === h || url.hostname.endsWith(`.${h}`));
    if (url.protocol !== 'https:' || !okHost) return { success: false, error: 'El enlace no es de esa plataforma.' };

    try {
        await prisma.$transaction(async tx => {
            const ext = await tx.externalReview.create({
                data: {
                    source: input.source,
                    url: `${url.origin}${url.pathname}`, // drop tracking params
                    reviewerName: input.reviewerName?.trim() || null,
                    reviewDate: businessDateToUtcDate(input.reviewDate),
                    enteredBy: input.cloverEmployeeId,
                },
            });
            await tx.reviewClaim.create({
                data: {
                    source: input.source,
                    externalReviewId: ext.id,
                    cloverEmployeeId: input.cloverEmployeeId,
                    employeeName: input.employeeName,
                    businessMonth: monthOf(input.reviewDate),
                },
            });
        });
    } catch {
        return { success: false, error: 'Esa reseña ya fue registrada.' };
    }
    revalidatePath(ROUTE);
    return { success: true };
}

/** Manager approves or rejects a pending claim. For external reviews the manager types the stars after checking the link. */
export async function decideClaim(input: {
    claimId: string;
    approve: boolean;
    decidedBy: string;
    starRating?: number;
    rejectReason?: string;
}): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo gerencia.' };
    const claim = await prisma.reviewClaim.findUnique({ where: { id: input.claimId } });
    if (!claim || claim.status !== 'PENDING') return { success: false, error: 'Este reclamo ya fue decidido.' };

    await prisma.$transaction(async tx => {
        await tx.reviewClaim.update({
            where: { id: claim.id },
            data: {
                status: input.approve ? 'APPROVED' : 'REJECTED',
                pointsAwarded: input.approve ? await pointsFor(claim.source) : null,
                decidedAt: new Date(),
                decidedBy: input.decidedBy,
                rejectReason: input.approve ? null : input.rejectReason ?? null,
            },
        });
        if (claim.externalReviewId && input.starRating) {
            await tx.externalReview.update({ where: { id: claim.externalReviewId }, data: { starRating: input.starRating } });
            if (input.starRating <= LOW_REVIEW_MAX_STARS) {
                await tx.reviewFollowUp.upsert({
                    where: { externalReviewId: claim.externalReviewId },
                    create: { externalReviewId: claim.externalReviewId, starRating: input.starRating },
                    update: {},
                });
            }
        }
    });
    revalidatePath(ROUTE);
    return { success: true };
}

export type LeaderboardRow = { cloverEmployeeId: string; employeeName: string; points: number; reviews: number; pending: number };

/** Monthly standings. Approved points only; pending shown so nobody is surprised. */
export async function getLeaderboard(month: string = monthOf(getBusinessDate())): Promise<LeaderboardRow[]> {
    const claims = await prisma.reviewClaim.findMany({
        where: { businessMonth: month, status: { in: ['APPROVED', 'PENDING'] } },
        select: { cloverEmployeeId: true, employeeName: true, status: true, pointsAwarded: true },
    });
    const by = new Map<string, LeaderboardRow>();
    for (const c of claims) {
        const row = by.get(c.cloverEmployeeId) ??
            { cloverEmployeeId: c.cloverEmployeeId, employeeName: c.employeeName, points: 0, reviews: 0, pending: 0 };
        if (c.status === 'APPROVED') { row.points += c.pointsAwarded ?? 0; row.reviews += 1; }
        else row.pending += 1;
        by.set(c.cloverEmployeeId, row);
    }
    return [...by.values()].sort((a, b) => b.points - a.points || b.reviews - a.reviews);
}

/** Open low reviews for the Management station. */
export async function getOpenFollowUps() {
    if (!(await isAdminSession())) return [];
    return prisma.reviewFollowUp.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        include: { gbpReview: true, externalReview: true },
    });
}

export async function resolveFollowUp(input: { id: string; note: string; resolvedBy: string }) {
    if (!(await isAdminSession())) return { success: false, error: 'Solo gerencia.' };
    await prisma.reviewFollowUp.update({
        where: { id: input.id },
        data: { status: 'RESOLVED', note: input.note, resolvedBy: input.resolvedBy, resolvedAt: new Date() },
    });
    revalidatePath(ROUTE);
    return { success: true };
}

export async function setSourcePoints(source: ReviewSource, points: number) {
    if (!(await isAdminSession())) return { success: false, error: 'Solo gerencia.' };
    if (!Number.isInteger(points) || points < 0 || points > 10) return { success: false, error: 'Entre 0 y 10.' };
    await prisma.reviewPointsRule.upsert({ where: { source }, create: { source, points }, update: { points } });
    revalidatePath(ROUTE);
    return { success: true };
}

export type PendingClaim = {
    id: string;
    source: ReviewSource;
    employeeName: string;
    claimedAt: string;
    starRating: number | null;
    comment: string | null;
    url: string | null;
    suggestedName: string | null;
};

/** Claims waiting for a manager, oldest first. */
export async function getPendingClaims(): Promise<PendingClaim[]> {
    if (!(await isAdminSession())) return [];
    const [rows, { staff }] = await Promise.all([
        prisma.reviewClaim.findMany({
            where: { status: 'PENDING' },
            orderBy: { claimedAt: 'asc' },
            include: { gbpReview: true, externalReview: true },
        }),
        getTipEligibleStaff(),
    ]);
    const nameOf = new Map(staff.map(s => [s.id, s.name]));
    return rows.map(c => ({
        id: c.id,
        source: c.source,
        employeeName: c.employeeName,
        claimedAt: c.claimedAt.toISOString(),
        starRating: c.gbpReview?.starRating ?? c.externalReview?.starRating ?? null,
        comment: c.gbpReview?.comment ?? null,
        url: c.externalReview?.url ?? null,
        suggestedName: c.suggestedStaffId ? nameOf.get(c.suggestedStaffId) ?? null : null,
    }));
}

export type OpenFollowUp = {
    id: string;
    starRating: number;
    comment: string | null;
    reviewerName: string | null;
    url: string | null;
    source: ReviewSource;
    createdAt: string;
};

/** Plain-object version of getOpenFollowUps for the client panel. */
export async function getOpenFollowUpRows(): Promise<OpenFollowUp[]> {
    const rows = await getOpenFollowUps();
    return rows.map(f => ({
        id: f.id,
        starRating: f.starRating,
        comment: f.gbpReview?.comment ?? null,
        reviewerName: f.gbpReview?.reviewerName ?? f.externalReview?.reviewerName ?? null,
        url: f.externalReview?.url ?? null,
        source: f.externalReview?.source ?? 'GOOGLE',
        createdAt: (f.gbpReview?.createTime ?? f.createdAt).toISOString(),
    }));
}
