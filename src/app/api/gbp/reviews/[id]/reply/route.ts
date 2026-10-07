/**
 * PUT    /api/gbp/reviews/:id/reply   { comment: string }  → post/overwrite owner reply
 * DELETE /api/gbp/reviews/:id/reply                         → remove owner reply
 *
 * :id = GbpReview.id (Google reviewId). Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { replyToReview, deleteReviewReply } from "@/lib/gbp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(req: NextRequest) {
  return req.cookies.get("fusionista_admin")?.value === "true";
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { comment?: string };
  const comment = body.comment?.trim();
  if (!comment) return NextResponse.json({ error: "comment required" }, { status: 400 });
  if (comment.length > 4096) return NextResponse.json({ error: "comment too long (max 4096)" }, { status: 400 });

  const review = await prisma.gbpReview.findUnique({ where: { id }, select: { name: true } });
  if (!review) return NextResponse.json({ error: "review not found" }, { status: 404 });

  await replyToReview(review.name, comment);
  const now = new Date();
  await prisma.gbpReview.update({ where: { id }, data: { replyComment: comment, replyTime: now } });
  return NextResponse.json({ ok: true, replyComment: comment, replyTime: now });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await ctx.params;
  const review = await prisma.gbpReview.findUnique({ where: { id }, select: { name: true } });
  if (!review) return NextResponse.json({ error: "review not found" }, { status: 404 });

  await deleteReviewReply(review.name);
  await prisma.gbpReview.update({ where: { id }, data: { replyComment: null, replyTime: null } });
  return NextResponse.json({ ok: true });
}
