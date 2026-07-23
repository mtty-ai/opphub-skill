// /api/onboarding/status · 引导状态
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/packages/db/prisma';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JWT_SECRET = process.env.OPPHUB_JWT_SECRET || 'dev-secret-change-me';

function getOpcId(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    return payload.opcId;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const opcId = getOpcId(req);
  if (!opcId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const account = await prisma.opcAccount.findUnique({
    where: { opcId },
    include: { company: true, profile: true, channels: true, trustScore: true, balanceAccount: true },
  });
  if (!account) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  // 计算当前引导步骤
  let currentStep = 1;
  if (account.email || account.phone) currentStep = 2;
  if (account.channels.length >= 1) currentStep = 3;
  if (account.kycLevel >= 1) currentStep = 4;
  if (account.company && account.profile) currentStep = 5;
  if (account.profile?.subSkills?.length > 0) currentStep = 6;

  return NextResponse.json({
    ok: true,
    opcId,
    currentStep,
    totalSteps: 6,
    completed: currentStep >= 6,
    trustScore: account.trustScore?.score || 70,
    balance: account.balanceAccount?.balance || 0,
  });
}