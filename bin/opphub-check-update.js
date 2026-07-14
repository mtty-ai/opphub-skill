#!/usr/bin/env node
// opphub-check-update.js · v3.0.0-alpha.5
//
// 用途: cron 定时跑, 检查 skill 自身是否有新版本
//       alpha.5 占位, alpha.6 实跑 clawhub inspect
//
// 现状(alpha.5):
// - 跑 'openclaw skills info opphub' 拿当前 version
// - 跑 'curl https://github.com/mtty-ai/opphub-skill/releases/latest' 拿最新 tag
// - 对比, 有新版本就返 upgrade_available
// - 没有新版本就返 up_to_date
// - 错误一律静默, 不打扰用户 (老板 7/06 10:40 拍点)

import { exec } from "node:child_process";
import { promisify } from "node:util";
const execp = promisify(exec);

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function getLocalVersion() {
  try {
    const { stdout } = await execp("openclaw skills info opphub --json 2>/dev/null");
    const startIdx = stdout.indexOf("{");
    if (startIdx < 0) return null;
    const json = JSON.parse(stdout.slice(startIdx));
    // SKILL.md frontmatter version 是源头, 但 'version' 可能在不同位置
    return json?.frontmatter?.version ?? json?.version ?? null;
  } catch {
    return null;
  }
}

async function getRemoteVersion() {
  try {
    // alpha.5 简化: 拿 GitHub API latest release 的 tag
    const { stdout } = await execp(
      "gh release view --repo mtty-ai/opphub-skill --json tagName -q .tagName 2>/dev/null"
    );
    return stdout.trim().replace(/^v/, "") || null;
  } catch {
    return null;
  }
}

function compareSemver(a, b) {
  // "3.0.0-alpha.5" 这种带预发布标签也算
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] ?? "0";
    const bi = pb[i] ?? "0";
    if (ai !== bi) {
      const an = parseInt(ai.split("-")[0], 10);
      const bn = parseInt(bi.split("-")[0], 10);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
      return ai.localeCompare(bi);
    }
  }
  return 0;
}

async function main() {
  const local = await getLocalVersion();
  const remote = await getRemoteVersion();

  if (!local) {
    out({ ok: true, status: "unknown", reason: "local version 不可读, 静默" });
    return;
  }
  if (!remote) {
    out({ ok: true, status: "unknown", reason: "remote version 不可读, 静默", local });
    return;
  }

  const cmp = compareSemver(local, remote);
  if (cmp < 0) {
    out({
      ok: true,
      status: "upgrade_available",
      local,
      remote,
      upgrade_cmd: "clawhub install opphub",
      hint: `skill 有新版本 v${remote} (当前 v${local})`,
    });
    return;
  }

  out({ ok: true, status: "up_to_date", local, remote });
}

main().catch((e) => {
  // alpha.5 静默: cron 跑出错不能打扰用户
  console.log(JSON.stringify({ ok: false, status: "error", error: e?.message ?? String(e) }));
  process.exit(0); // 不返非0, 让 cron 标记为 ok
}));