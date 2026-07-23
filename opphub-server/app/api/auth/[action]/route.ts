// /api/auth/[action] · 聚合 7 个 auth API
// 路由：code/send / register / login / passwd / kyc / me
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/packages/db/prisma';
import { redis } from '@/packages/db/redis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JWT_SECRET = process.env.OPPHUB_JWT_SECRET || 'dev-secret-change-me';
const CODE_TTL = 300; // 5 分钟
const MAX_PER_IP = 5; // 5 次/分钟

// ==================== POST /api/auth/code/send ====================
async function sendCode(body: any) {
  const schema = z.object({
    type: z.enum(['email', 'phone']),
    target: z.string().min(3).max(100),
    purpose: z.enum(['register', 'login', 'passwd', 'kyc']),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: 'invalid_input', detail: parsed.error.format() };

  const { type, target, purpose } = parsed.data;

  // 频率限制（按 IP+target）
  const rateKey = `code:${target}:${Math.floor(Date.now() / 60000)}`;
  const count = await redis.incr(rateKey);
  if (count > MAX_PER_IP) return { error: 'rate_limit', message: '每分钟最多 5 次' };
  await redis.expire(rateKey, 60);

  // 生成 6 位验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // 存到 DB
  await prisma.verifyCode.create({
    data: {
      target,
      code,
      purpose,
      expireAt: new Date(Date.now() + CODE_TTL * 1000),
    },
  });

  // ★ TODO: 实际发送（V0.5 先 mock）
  // email: 调 SendGrid / SES
  // phone: 调阿里云短信
  console.log(`[验证码] ${type}:${target} code=${code} purpose=${purpose}`);

  return { ok: true, message: '验证码已发送', ttl: CODE_TTL };
}

// ==================== POST /api/auth/register ====================
async function register(body: any) {
  const schema = z.object({
    type: z.enum(['email', 'phone']),
    target: z.string(),
    code: z.string().length(6),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: 'invalid_input' };

  const { type, target, code } = parsed.data;

  // 校验验证码
  const verify = await prisma.verifyCode.findFirst({
    where: { target, code, used: false, expireAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!verify) return { error: 'invalid_code', message: '验证码错误或过期' };

  // 检查是否已注册
  const where = type === 'email' ? { email: target } : { phone: target };
  const existing = await prisma.opcAccount.findFirst({ where });
  if (existing) return { error: 'already_registered', message: '该邮箱/手机号已注册，请直接登录' };

  // 创建账号
  const opcId = `opc_${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  const account = await prisma.opcAccount.create({
    data: {
      opcId,
      ...(type === 'email' ? { email: target } : { phone: target }),
      status: 'ACTIVE',
    },
  });

  // 标记验证码用掉
  await prisma.verifyCode.update({ where: { id: verify.id }, data: { used: true } });

  // 初始化信用分
  await prisma.opcTrustScore.create({ data: { opcId, score: 70 } });

  // 初始化余额账户
  await prisma.balanceAccount.create({ data: { opcId, balance: 0, frozen: 0 } });

  // 默认绑邮件通道（如果邮箱注册）
  if (type === 'email') {
    await prisma.opcChannel.create({
      data: { opcId, channelType: 'email', channelId: target, isDefault: true },
    });
  }

  // 发 token
  const opphubToken = jwt.sign({ opcId, scope: ['opphub:profile:rw', 'opphub:match:read', 'opphub:order:rw'] }, JWT_SECRET, { expiresIn: '30d' });

  return {
    ok: true,
    opcId,
    opphubToken,
    message: '注册成功，请完成 6 步引导',
  };
}

// ==================== POST /api/auth/login ====================
async function login(body: any) {
  const schema = z.object({
    type: z.enum(['email', 'phone']),
    target: z.string(),
    code: z.string().optional(),
    password: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: 'invalid_input' };

  const { type, target, code, password } = parsed.data;

  // 找账号
  const where = type === 'email' ? { email: target } : { phone: target };
  const account = await prisma.opcAccount.findFirst({ where });
  if (!account) return { error: 'not_found', message: '账号不存在，请先注册' };

  // 验证码登录
  if (code) {
    const verify = await prisma.verifyCode.findFirst({
      where: { target, code, used: false, expireAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!verify) return { error: 'invalid_code' };
    await prisma.verifyCode.update({ where: { id: verify.id }, data: { used: true } });
  }
  // 密码登录
  else if (password) {
    if (!account.passwordHash) return { error: 'no_password', message: '该账号未设密码，请用验证码登录' };
    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) return { error: 'invalid_password' };
  } else {
    return { error: 'missing_credentials' };
  }

  // 更新 lastLoginAt
  await prisma.opcAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });

  // 发 token
  const opphubToken = jwt.sign({ opcId: account.opcId, email: account.email, phone: account.phone }, JWT_SECRET, { expiresIn: '30d' });

  return { ok: true, opcId: account.opcId, opphubToken, email: account.email, phone: account.phone };
}

// ==================== POST /api/auth/passwd ====================
async function changePassword(body: any, opcId: string) {
  const schema = z.object({
    code: z.string().length(6),
    newPassword: z.string().min(8).max(20),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: 'invalid_input' };

  const account = await prisma.opcAccount.findUnique({ where: { opcId } });
  if (!account) return { error: 'not_found' };

  const target = account.email || account.phone || '';
  const verify = await prisma.verifyCode.findFirst({
    where: { target, code: parsed.data.code, used: false, expireAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!verify) return { error: 'invalid_code' };

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.opcAccount.update({ where: { id: account.id }, data: { passwordHash: hash } });
  await prisma.verifyCode.update({ where: { id: verify.id }, data: { used: true } });

  return { ok: true };
}

// ==================== POST /api/auth/kyc ====================
async function kyc(body: any, opcId: string) {
  const schema = z.object({
    phone: z.string(),
    code: z.string().length(6).optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: 'invalid_input' };

  // 验证码校验（如果有）
  if (parsed.data.code) {
    const verify = await prisma.verifyCode.findFirst({
      where: { target: parsed.data.phone, code: parsed.data.code, used: false, expireAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!verify) return { error: 'invalid_code' };
    await prisma.verifyCode.update({ where: { id: verify.id }, data: { used: true } });
  }

  await prisma.opcAccount.update({
    where: { opcId },
    data: { phone: parsed.data.phone, kycLevel: 1 },
  });

  // 信用分 +10
  await prisma.opcTrustScore.update({ where: { opcId }, data: { score: { increment: 10 } } });

  return { ok: true, message: 'KYC 完成，信用分 +10' };
}

// ==================== GET /api/auth/me ====================
async function me(opcId: string) {
  const account = await prisma.opcAccount.findUnique({
    where: { opcId },
    include: { trustScore: true, balanceAccount: true, company: true, profile: true },
  });
  if (!account) return { error: 'not_found' };
  return { ok: true, ...account };
}

// ==================== 路由分发 ====================
export async function POST(req: NextRequest, { params }: { params: { action: string[] } }) {
  const [resource, ...rest] = params.action;
  const body = await req.json().catch(() => ({}));

  // 从 Authorization header 提取 opcId
  const auth = req.headers.get('authorization');
  let opcId: string | null = null;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
      opcId = payload.opcId;
    } catch {}
  }

  try {
    let result: any;
    switch (resource) {
      case 'code':
        result = await sendCode({ ...body, purpose: rest[0] || body.purpose });
        break;
      case 'register':
        if (!opcId) result = await register(body);
        else result = { error: 'already_logged_in' };
        break;
      case 'login':
        result = await login(body);
        break;
      case 'passwd':
        if (!opcId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        result = await changePassword(body, opcId);
        break;
      case 'kyc':
        if (!opcId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        result = await kyc(body, opcId);
        break;
      default:
        return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { action: string[] } }) {
  const [resource] = params.action;
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    if (resource === 'me') {
      const result = await me(payload.opcId);
      return NextResponse.json(result);
    }
    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 401 });
  }
}