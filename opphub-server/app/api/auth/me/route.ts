// GET /api/auth/me
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/packages/db/prisma';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JWT_SECRET = process.env.OPPHUB_JWT_SECRET || 'dev-secret-change-me';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;

    const account = await prisma.opcAccount.findUnique({
      where: { opcId: payload.opcId },
      include: { trustScore: true, balanceAccount: true, company: true, profile: true },
    });
    if (!account) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    return NextResponse.json({ ok: true, ...account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
  }
}