// POST /api/auth/register
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/packages/db/prisma';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JWT_SECRET = process.env.OPPHUB_JWT_SECRET || 'dev-secret-change-me';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const schema = z.object({
      type: z.enum(['email', 'phone']),
      target: z.string(),
      code: z.string().length(6),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_input' });

    const { type, target, code } = parsed.data;

    const verify = await prisma.verifyCode.findFirst({
      where: { target, code, used: false, expireAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!verify) return NextResponse.json({ ok: false, error: 'invalid_code', message: '验证码错误或过期' });

    const where = type === 'email' ? { email: target } : { phone: target };
    const existing = await prisma.opcAccount.findFirst({ where });
    if (existing) return NextResponse.json({ ok: false, error: 'already_registered', message: '该邮箱/手机号已注册，请直接登录' });

    const opcId = `opc_${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    const account = await prisma.opcAccount.create({
      data: {
        opcId,
        ...(type === 'email' ? { email: target } : { phone: target }),
        status: 'ACTIVE',
      },
    });

    await prisma.verifyCode.update({ where: { id: verify.id }, data: { used: true } });
    await prisma.opcTrustScore.create({ data: { opcId, score: 70 } });
    await prisma.balanceAccount.create({ data: { opcId, balance: 0, frozen: 0 } });

    if (type === 'email') {
      await prisma.opcChannel.create({
        data: { opcId, channelType: 'email', channelId: target, isDefault: true },
      });
    }

    const opphubToken = jwt.sign(
      { opcId, scope: ['opphub:profile:rw', 'opphub:match:read', 'opphub:order:rw'] },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return NextResponse.json({
      ok: true,
      opcId,
      opphubToken,
      message: '注册成功，请完成 6 步引导',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}