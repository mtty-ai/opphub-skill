// tRPC 路由（v3.2:register/login 双模式 + jti 黑名单 + logout）
// 7 个子路由：health / auth / profile / match / balance / order / credit
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Context } from './context';
import { redis } from '@/packages/db/redis';
import { sendEmailCode } from '@/lib/email';
import { sendSmsCode } from '@/lib/sms';

const t = initTRPC.context<Context>().create();

// 中间件：先校验 token，再查 jti 是否还在
const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.opcId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
  }
  if (ctx.jti) {
    const exists = await redis.get(`jti:${ctx.jti}`);
    if (!exists) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' });
    }
  }
  return next({ ctx: { ...ctx, opcId: ctx.opcId } });
});

const publicProcedure = t.procedure;

const JWT_SECRET = process.env.OPPHUB_JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '30d';

function genCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function genOpcId(): string {
  return 'opc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// 签发 JWT（含 jti 存 Redis）—— ★ 30 天后 jti 自动失效
async function signToken(payload: { opcId: string; email?: string; phone?: string; scope?: string[] }): Promise<{ token: string; jti: string; expiresIn: number }> {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      jti,
      opcId: payload.opcId,
      email: payload.email,
      phone: payload.phone,
      scope: payload.scope || ['opc:basic'],
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
  await redis.set(`jti:${jti}`, payload.opcId, 'EX', 30 * 24 * 3600);
  // 每个 opcId 保持一个 active_jti，新登录会顶掉老登录
  const prev = await redis.get(`active_jti:${payload.opcId}`);
  if (prev && prev !== jti) {
    await redis.del(`jti:${prev}`);
  }
  await redis.set(`active_jti:${payload.opcId}`, jti, 'EX', 30 * 24 * 3600);
  return { token, jti, expiresIn: 30 * 24 * 3600 };
}

// 注销：删 jti
async function revokeJti(jti: string, opcId?: string): Promise<boolean> {
  const existed = await redis.get(`jti:${jti}`);
  await redis.del(`jti:${jti}`);
  if (opcId) {
    const active = await redis.get(`active_jti:${opcId}`);
    if (active === jti) await redis.del(`active_jti:${opcId}`);
  }
  return !!existed;
}

async function sendCodeForReal(type: 'email' | 'phone', target: string, purpose: string, code: string): Promise<boolean> {
  if (type === 'email') return sendEmailCode(target, code, purpose);
  return sendSmsCode(target, code, purpose);
}

export const appRouter = t.router({
  health: t.router({
    ping: t.procedure.query(() => ({ ok: true, timestamp: new Date().toISOString() })),
  }),

  auth: t.router({
    // 发验证码（公开）
    sendCode: publicProcedure
      .input(z.object({
        type: z.enum(['email', 'phone']),
        target: z.string().min(3),
        purpose: z.enum(['register', 'login', 'passwd', 'kyc']),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.type === 'email' && !/^[^@]+@[^@]+\.[^@]+$/.test(input.target)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '邮箱格式不对' });
        }
        if (input.type === 'phone' && !/^1[3-9][0-9]{9}$/.test(input.target)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '手机号格式不对' });
        }
        const dedupKey = `dedup:${input.type}:${input.target}:${input.purpose}`;
        if (await redis.get(dedupKey)) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: '请 60 秒后再发' });
        }
        const code = genCode();
        const ttl = 5 * 60;
        // ★ 同时写 Redis 和 DB（双轨，register 时都能读到）
        await redis.set(`code:${input.type}:${input.target}:${input.purpose}`, code, 'EX', ttl);
        await redis.set(dedupKey, '1', 'EX', 60);
        await ctx.prisma.verifyCode.create({
          data: {
            target: input.target,
            code,
            purpose: input.purpose,
            expireAt: new Date(Date.now() + ttl * 1000),
          },
        }).catch(() => {});  // DB 写失败不影响发送
        const sent = await sendCodeForReal(input.type, input.target, input.purpose, code);
        if (!sent) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '验证码发送失败' });
        }
        return {
          ok: true,
          ttl,
          target: input.type === 'email'
            ? input.target.replace(/(^.).+(@.*$)/, '$1***$2')
            : input.target.slice(0, 3) + '****' + input.target.slice(-4),
        };
      }),

    // 注册（公开）—— ★ 可选 password
    register: publicProcedure
      .input(z.object({
        type: z.enum(['email', 'phone']),
        target: z.string(),
        code: z.string().length(6),
        password: z.string().min(8).max(64).optional(),  // ★ 首次可设密码
      }))
      .mutation(async ({ ctx, input }) => {
        // 验证码校验
        const key = `code:${input.type}:${input.target}:register`;
        let stored = await redis.get(key);
        if (!stored) {
          const dbCode = await ctx.prisma.verifyCode.findFirst({
            where: { target: input.target, purpose: 'register', used: false, expireAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
          });
          stored = dbCode?.code ?? null;
        }
        if (!stored || stored !== input.code) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '验证码错误或已过期' });
        }

        const existing = await ctx.prisma.opcAccount.findFirst({
          where: input.type === 'email' ? { email: input.target } : { phone: input.target },
        });
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: `${input.type === 'email' ? '邮箱' : '手机号'}已注册，请直接登录` });
        }

        const opcId = genOpcId();
        const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;

        await ctx.prisma.opcAccount.create({
          data: {
            opcId,
            email: input.type === 'email' ? input.target : null,
            phone: input.type === 'phone' ? input.target : null,
            passwordHash,  // ★ 首次密码(可选)
            lastLoginAt: new Date(),
          },
        });

        await ctx.prisma.opcTrustScore.create({
          data: { opcId, score: 60, behavior: 0, transaction: 0, peerReview: 0 },
        }).catch(() => {});
        await ctx.prisma.balanceAccount.create({
          data: { opcId, balance: 0, frozen: 0 },
        }).catch(() => {});

        await redis.del(key);
        await ctx.prisma.verifyCode.updateMany({
          where: { target: input.target, purpose: 'register', used: false },
          data: { used: true },
        }).catch(() => {});

        const { token, jti, expiresIn } = await signToken({ opcId, [input.type]: input.target });
        return { ok: true, opcId, opphubToken: token, jti, expiresIn, hasPassword: !!passwordHash };
      }),

    // 登录（公开）—— ★ 支持验证码 OR 密码
    login: publicProcedure
      .input(z.object({
        type: z.enum(['email', 'phone']),
        target: z.string(),
        code: z.string().length(6).optional(),
        password: z.string().min(8).max(64).optional(),
      }).refine(d => !!(d.code || d.password), {
        message: 'code 或 password 二选一',
      }))
      .mutation(async ({ ctx, input }) => {
        const account = await ctx.prisma.opcAccount.findFirst({
          where: input.type === 'email' ? { email: input.target } : { phone: input.target },
        });
        if (!account) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `${input.type === 'email' ? '邮箱' : '手机号'}未注册` });
        }

        // 密码登录分支
        if (input.password) {
          if (!account.passwordHash) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '该账号未设置密码，请用验证码登录或先设置密码' });
          }
          const ok = await bcrypt.compare(input.password, account.passwordHash);
          if (!ok) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '密码错误' });
          }
        }
        // 验证码登录分支
        else if (input.code) {
          const key = `code:${input.type}:${input.target}:login`;
          let stored = await redis.get(key);
          if (!stored) {
            const dbCode = await ctx.prisma.verifyCode.findFirst({
              where: { target: input.target, purpose: 'login', used: false, expireAt: { gt: new Date() } },
              orderBy: { createdAt: 'desc' },
            });
            stored = dbCode?.code ?? null;
          }
          if (!stored || stored !== input.code) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '验证码错误或已过期' });
          }
          await redis.del(key);
          await ctx.prisma.verifyCode.updateMany({
            where: { target: input.target, purpose: 'login', used: false },
            data: { used: true },
          }).catch(() => {});
        }

        await ctx.prisma.opcAccount.update({
          where: { id: account.id },
          data: { lastLoginAt: new Date() },
        });

        const { token, jti, expiresIn } = await signToken({
          opcId: account.opcId,
          [input.type]: input.target,
        });
        return {
          ok: true,
          opcId: account.opcId,
          opphubToken: token,
          jti,
          expiresIn,
          hasPassword: !!account.passwordHash,
          loginMethod: input.password ? 'password' : 'code',
        };
      }),

    // 注销（公开）—— 删 jti
    logout: publicProcedure
      .input(z.object({
        jti: z.string().optional(),
        opcId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        if (!input.jti && !input.opcId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'jti 或 opcId 二选一' });
        }
        if (input.jti) {
          const ok = await revokeJti(input.jti, input.opcId);
          return { ok, message: ok ? '已注销' : 'jti 不存在或已过期' };
        }
        // 按 opcId 注销：删 active_jti + jti
        const active = await redis.get(`active_jti:${input.opcId!}`);
        if (active) await redis.del(`jti:${active}`);
        await redis.del(`active_jti:${input.opcId!}`);
        return { ok: true, message: '已注销该账号所有 session' };
      }),

    // 当前账号（需登录）—— ★ 返 hasPassword
    me: protectedProcedure.query(async ({ ctx }) => {
      const account = await ctx.prisma.opcAccount.findUnique({
        where: { opcId: ctx.opcId! },
        include: { profile: true, company: true, trustScore: true },
      });
      if (!account) return null;
      return {
        ...account,
        hasPassword: !!account.passwordHash,
        passwordHash: undefined,  // 不返回 hash
      };
    }),

    // KYC（需登录）
    kyc: protectedProcedure
      .input(z.object({
        realName: z.string().min(2),
        idCard: z.string().regex(/^\d{17}[\dXx]$/, '身份证号格式不对'),
        phone: z.string().regex(/^1[3-9][0-9]{9}$/, '手机号格式不对'),
        code: z.string().length(6),
      }))
      .mutation(async ({ ctx, input }) => {
        const key = `code:phone:${input.phone}:kyc`;
        let stored = await redis.get(key);
        if (!stored) {
          const dbCode = await ctx.prisma.verifyCode.findFirst({
            where: { target: input.phone, purpose: 'kyc', used: false, expireAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
          });
          stored = dbCode?.code ?? null;
        }
        if (!stored || stored !== input.code) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'KYC 验证码错误或已过期' });
        }
        await redis.del(key);
        await ctx.prisma.verifyCode.updateMany({
          where: { target: input.phone, purpose: 'kyc', used: false },
          data: { used: true },
        }).catch(() => {});

        await ctx.prisma.opcAccount.update({
          where: { opcId: ctx.opcId! },
          data: { kycLevel: 1 },
        });
        await ctx.prisma.opcTrustScore.upsert({
          where: { opcId: ctx.opcId! },
          create: { opcId: ctx.opcId!, score: 70, behavior: 10, transaction: 0, peerReview: 0 },
          update: { score: { increment: 10 }, behavior: { increment: 10 } },
        });
        return { ok: true, kycLevel: 1, message: 'KYC 完成，信用分 +10' };
      }),

    // 设置/修改密码（需登录）—— ★ 无密码直接设，有密码需老密码验证
    passwd: protectedProcedure
      .input(z.object({
        newPassword: z.string().min(8).max(64),
        oldPassword: z.string().min(8).max(64).optional(),  // 已有密码时必填
        code: z.string().length(6).optional(),              // 已有密码时用验证码代替老密码
      }).refine(d => !!(d.oldPassword || d.code) || true, {
        // 首次设密码可以不带 oldPassword/code
        message: '已有密码时必须提供 oldPassword 或 code',
      }))
      .mutation(async ({ ctx, input }) => {
        const account = await ctx.prisma.opcAccount.findUnique({ where: { opcId: ctx.opcId! } });
        if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: '账号不存在' });

        // 已设密码 → 必须验证
        if (account.passwordHash) {
          let verified = false;
          if (input.oldPassword) {
            verified = await bcrypt.compare(input.oldPassword, account.passwordHash);
          } else if (input.code) {
            const target = account.email || account.phone || '';
            const type = account.email ? 'email' : 'phone';
            const key = `code:${type}:${target}:passwd`;
            let stored = await redis.get(key);
            if (!stored) {
              const dbCode = await ctx.prisma.verifyCode.findFirst({
                where: { target, purpose: 'passwd', used: false, expireAt: { gt: new Date() } },
                orderBy: { createdAt: 'desc' },
              });
              stored = dbCode?.code ?? null;
            }
            verified = stored === input.code;
            if (verified) {
              await redis.del(key);
              await ctx.prisma.verifyCode.updateMany({
                where: { target, purpose: 'passwd', used: false },
                data: { used: true },
              }).catch(() => {});
            }
          }
          if (!verified) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '老密码或验证码不正确' });
          }
        }

        const passwordHash = await bcrypt.hash(input.newPassword, 10);
        await ctx.prisma.opcAccount.update({
          where: { opcId: ctx.opcId! },
          data: { passwordHash },
        });
        return { ok: true, message: account.passwordHash ? '密码已修改' : '密码已设置' };
      }),
  }),

  // profile
  profile: t.router({
    get: publicProcedure.input(z.object({ opcId: z.string() })).query(async ({ ctx, input }) => {
      const account = await ctx.prisma.opcAccount.findUnique({
        where: { opcId: input.opcId },
        include: { profile: true, company: true, trustScore: true },
      });
      if (!account) return null;
      const { passwordHash: _, ...rest } = account;
      return rest;
    }),

    parse: publicProcedure
      .input(z.object({ text: z.string(), opcId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        return {
          ok: true,
          message: 'profile.parse 待接入 BGE-M3',
          rawText: input.text,
          opcId: input.opcId || ctx.opcId || null,
        };
      }),
  }),

  match: t.router({
    recommend: protectedProcedure
      .input(z.object({ opcId: z.string(), limit: z.number().default(10) }))
      .query(async ({ ctx, input }) => {
        return ctx.prisma.matchingRecord.findMany({
          where: { opcId: input.opcId },
          orderBy: { totalScore: 'desc' },
          take: input.limit,
          include: { demand: true },
        });
      }),

    run: protectedProcedure
      .input(z.object({ opcId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        return { ok: true, message: 'match.run 待接入撮合引擎' };
      }),

    interest: protectedProcedure
      .input(z.object({ matchId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.prisma.matchingRecord.update({
          where: { id: input.matchId },
          data: { interest: true },
        });
      }),
  }),

  balance: t.router({
    get: protectedProcedure.input(z.object({ opcId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.prisma.balanceAccount.findUnique({ where: { opcId: input.opcId } });
    }),
  }),

  order: t.router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return ctx.prisma.order.findMany({
        where: { opcId: ctx.opcId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    }),

    create: protectedProcedure
      .input(z.object({ demandId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        return { ok: true, message: 'order.create 待实现' };
      }),
  }),

  credit: t.router({
    getScore: protectedProcedure.query(async ({ ctx }) => {
      return ctx.prisma.opcTrustScore.findUnique({ where: { opcId: ctx.opcId } });
    }),
  }),
});

export type AppRouter = typeof appRouter;