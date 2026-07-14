#!/usr/bin/env node
// opphub-cron-setup.js · v3.0.0-alpha.5
//
// 用途: 自动建 opphub-skill-daily-check cron 任务 (架构 B isolated + announce last)
//       幂等: 重复跑不会重复建, 自动覆盖原 config
//
// 设计 (老板 2026-07-06 10:14 + v3.0.0 协商):
// - 任务名固定 'opphub-skill-daily-check' (升级不变化)
// - 调度: cron "0 9 * * *" @ Asia/Shanghai (可配 OPPHUB_CRON_EXPR / OPPHUB_CRON_TZ)
// - sessionTarget: isolated (老板 7/06 架构 B 拍点)
// - delivery: announce last (老板 7/06 10:23 拍不硬编码通道)
// - argv: [node, bin/opphub-check-update.js]
//       (alpha.5 占位, alpha.6 实跑检查 clawhub 版本)
//
// alpha.5 步骤:
// 1. 调 'openclaw cron list --json' 查 opphub-skill-daily-check 在不在
// 2. 在 → 返 'already_installed', 顺便报 last_run / next_run / enabled
// 3. 不在 → 调 'openclaw cron add' 建 (带 --force 防止重名)
// 4. 返 'created' + 新 cron id

import { exec, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const execp = promisify(exec);

const CRON_NAME = "opphub-skill-daily-check";
const DEFAULT_EXPR = process.env.OPPHUB_CRON_EXPR || "0 9 * * *";
const DEFAULT_TZ = process.env.OPPHUB_CRON_TZ || "Asia/Shanghai";
// 与 skill/bin/opphub 在同目录, 引用绝对路径
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK_UPDATE_BIN = join(__dirname, "opphub-check-update.js");

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function err(code, message, extra = {}) {
  out({ ok: false, error: code, message, ...extra });
  process.exit(1);
}
// 调 openclaw cron list --json (隔离检查用 --json 拿 ID)
function execP(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const sp = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    sp.stdout.on("data", d => (stdout += d.toString()));
    sp.stderr.on("data", d => (stderr += d.toString()));
    sp.on("error", reject);
    sp.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${cmd} exit ${code}`), { code, stdout, stderr }));
    });
  });
}

async function cronListJson() {
  try {
    const { stdout } = await execP("openclaw", ["cron", "list", "--json"]);
    const objStart = stdout.indexOf("{");
    if (objStart < 0) return [];
    const obj = JSON.parse(stdout.slice(objStart));
    return Array.isArray(obj?.jobs) ? obj.jobs : (Array.isArray(obj) ? obj : []);
  } catch (e) {
    return [];
  }
}

async function cronExists() {
  const all = await cronListJson();
  return all.find((j) => j.name === CRON_NAME) ?? null;
}

// 调 openclaw cron add 建 cron (架构 B 标准模板, 老板 7/06 10:14 拍)
async function cronAdd() {
  // 用数组传 exec (不走 sh -c), 避免中文 + 括号被 shell 转义
  const argv = ["node", CHECK_UPDATE_BIN];
  const args = [
    "openclaw", "cron", "add",
    "--cron", DEFAULT_EXPR,
    "--tz", DEFAULT_TZ,
    "--name", CRON_NAME,
    "--description", "opphub skill daily check · check update, not 撮合",
    "--session", "isolated",
    "--announce",
    "--channel", "last",
    "--best-effort-deliver",
    "--command-argv", JSON.stringify(argv),
  ];
  const { stdout, stderr } = await execP("openclaw", ["cron", "add", ...args.slice(2)], { maxBuffer: 4 * 1024 * 1024 });
  return { stdout, stderr };
}

// 查 cron 状态 (含 enabled / last / next)
function shapeCron(j) {
  if (!j) return null;
  return {
    id: j.id ?? j.ID ?? null,
    name: j.name ?? null,
    enabled: j.enabled ?? true,
    schedule: j.schedule ?? j.expr ?? null,
    tz: j.tz ?? null,
    last_run_at: j.lastRunAt ?? j.last_run_at ?? null,
    next_run_at: j.nextRunAt ?? j.next_run_at ?? null,
    last_status: j.lastStatus ?? j.last_status ?? null,
    delivery: j.delivery ?? null,
    session_target: j.sessionTarget ?? j.session_target ?? null,
  };
}

async function main() {
  const cmd = process.argv[2] || "setup";

  if (cmd === "status") {
    const existing = await cronExists();
    if (!existing) {
      out({ ok: true, installed: false, hint: "cron 未建, 跑 'opphub cron-setup' 自动建" });
      return;
    }
    out({
      ok: true,
      installed: true,
      cron: shapeCron(existing),
      hint: "cron 已建, 每天跑一次. token/插件 检查走 status 的其他字段",
    });
    return;
  }

  if (cmd === "setup") {
    const existing = await cronExists();
    if (existing) {
      out({
        ok: true,
        action: "already_installed",
        cron: shapeCron(existing),
        hint: "幂等: 重复跑不会重复建",
      });
      return;
    }
    try {
      const { stdout, stderr } = await cronAdd();
      // 验证再建一次 (避免 --name 不接受重名 也 看不到错误)
      const after = await cronExists();
      if (!after) {
        err("cron_add_failed", "cron add 命令返了但查不到. 命令输出:" + (stdout || stderr).slice(0, 500));
      }
      out({
        ok: true,
        action: "created",
        cron: shapeCron(after),
        schedule_human: `${DEFAULT_EXPR} @ ${DEFAULT_TZ}`,
        argv,
        delivery: "announce -> channel=last",
        hint: "老板每天 09:00 会看到 cron 任务运行结果推到已配 IM",
      });
      return;
    } catch (e) {
      err("cron_add_error", e.message ?? String(e), { stderr: e.stderr ?? null });
    }
    return;
  }

  err("unknown_command", `unknown subcommand: ${cmd} (可用: setup / status)`);
}

main().catch((e) => err("internal_error", e.message ?? String(e)));