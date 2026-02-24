import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const count = await prisma.ingredient.count();
        return NextResponse.json({
            count,
            time: new Date().toISOString()
        });
    } catch (e: any) {
        return NextResponse.json({
            error: e.message,
            stack: e.stack,
            db: process.env.DATABASE_URL?.substring(0, 30) + '...',
            code: e.code
        }, { status: 500 });
    }
}
