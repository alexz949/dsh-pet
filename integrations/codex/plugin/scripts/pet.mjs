#!/usr/bin/env node
/**
 * Codex ↔ 桌宠：会话开始时（hooks 调用 `start`）没桌宠就拉起一只；也保留推状态的子命令备用。
 *
 * 用法：node pet.mjs <start|thinking|working|waiting|success|error|idle>
 *   start   会话开始：桌宠没在跑就在后台拉起独立模式（DSH 里已经有桌宠就不拉，免得两套）
 *   其余    把对应工作状态写进桌宠（idle = 清空回空闲）
 *
 * 推给谁（按顺序找）：
 *   1. 独立模式在跑：读 $DSH_HOME/dsh-pet/standalone-runtime.json 拿端口与令牌（只有本机用户可读）
 *   2. DSH 里的桌宠在跑：从桌宠日志找宿主地址（DSH 侧接口只听本机，不需要令牌）
 *   3. 都没有：start 时拉起独立模式；其余事件直接放弃
 *
 * 必须始终：快（每次调用最多约 1.5 秒）、安静（不往终端打印）、失败也退出 0——绝不卡住或打断 Codex。
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PET_DIR = join(HOME, 'dsh-pet');
const RUNTIME_FILE = join(PET_DIR, 'standalone-runtime.json');
const LOG_FILE = join(PET_DIR, 'logs.txt');
const ROUTE = '/dsh-pet-7340';
const STATES = new Set(['thinking', 'working', 'result', 'waiting', 'success', 'error']);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** 独立模式：运行状态文件在且进程活着 → { origin, token }。 */
function standaloneTarget() {
  try {
    const rt = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
    if (!Number.isInteger(rt.port) || typeof rt.token !== 'string' || !alive(rt.pid)) return null;
    return { origin: `http://127.0.0.1:${rt.port}`, token: rt.token };
  } catch {
    return null;
  }
}

/**
 * DSH 里的桌宠：桌面窗口进程在跑 → 从日志里最近一次「desktop helper started (config: …)」取宿主地址，
 * 并且这个地址真的连得上才算（桌宠刚退出时窗口进程会多活一小会儿，日志里也可能是独立模式留下的旧地址，
 * 不验证就会误以为「DSH 里有桌宠」而不去拉起）。
 */
async function dshTarget() {
  let running = false;
  try {
    running =
      execFileSync('pgrep', ['-f', 'dsh-pet/runtime/electron-helper/main.js'], {
        encoding: 'utf8',
      }).trim() !== '';
  } catch {
    running = false;
  }
  if (!running) return null;
  try {
    const log = readFileSync(LOG_FILE, 'utf8');
    const all = [
      ...log.matchAll(/desktop helper started \(config: (http:\/\/127\.0\.0\.1:\d+)\/dsh-pet-7340\/config\)/g),
    ];
    if (!all.length) return null;
    const origin = all[all.length - 1][1];
    await fetch(origin + ROUTE + '/state', {
      signal: AbortSignal.timeout(500),
    }); // 连不上会抛错 → null
    return { origin, token: null };
  } catch {
    return null;
  }
}

/** 找独立模式入口：环境变量 → PATH 上的 dsh-pet-standalone → 任一 DSH 配置里装着的 dsh-pet。 */
function standaloneEntry() {
  if (process.env.DSH_PET_STANDALONE && existsSync(process.env.DSH_PET_STANDALONE)) {
    return { cmd: process.execPath, args: [process.env.DSH_PET_STANDALONE] };
  }
  try {
    const bin = execFileSync('/usr/bin/which', ['dsh-pet-standalone'], {
      encoding: 'utf8',
    }).trim();
    if (bin) return { cmd: bin, args: [] };
  } catch {
    /* PATH 上没有 */
  }
  const profiles = join(HOME, 'profiles');
  try {
    for (const name of readdirSync(profiles)) {
      const entry = join(profiles, name, 'node_modules', 'dsh-pet', 'lib', 'standalone.js');
      if (existsSync(entry) && statSync(entry).isFile()) return { cmd: process.execPath, args: [entry] };
    }
  } catch {
    /* 没装过 DSH */
  }
  return null;
}

/** 后台拉起独立模式（与本进程脱离，Codex 会话结束也不受影响），最多等 8 秒到它写出运行状态。 */
async function launchStandalone() {
  const entry = standaloneEntry();
  if (!entry) return null;
  const child = spawn(entry.cmd, entry.args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DSH_HOME: HOME },
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const t = standaloneTarget();
    if (t) return t;
  }
  return null;
}

async function send(target, state) {
  const headers = { 'content-type': 'application/json' };
  if (target.token) headers['x-dsh-pet-token'] = target.token;
  const url = target.origin + ROUTE + '/work-status';
  const init =
    state === 'idle'
      ? { method: 'DELETE', headers }
      : {
          method: 'POST',
          headers,
          body: JSON.stringify({ state, task: null }),
        };
  await fetch(url, { ...init, signal: AbortSignal.timeout(1500) });
}

/** 排查用：设了 DSH_PET_HOOK_DEBUG=1 就把每次调用追加到 $DSH_HOME/dsh-pet/codex-hooks.log。 */
function debug(line) {
  if (!process.env.DSH_PET_HOOK_DEBUG) return;
  try {
    appendFileSync(join(PET_DIR, 'codex-hooks.log'), new Date().toISOString() + ' ' + line + '\n');
  } catch {
    /* 写不了日志也不影响 */
  }
}

async function main() {
  const action = process.argv[2] || '';
  // 读掉 hooks 喂进来的 stdin（不读的话某些情况下写端会阻塞）
  if (!process.stdin.isTTY) process.stdin.resume().on('data', () => {});
  const target = standaloneTarget() || (await dshTarget());
  if (action === 'start') {
    if (target) debug('start: 桌宠已在跑 ' + target.origin);
    else debug('start: 拉起独立模式 → ' + ((await launchStandalone())?.origin ?? '失败'));
    return;
  }
  if (!target) {
    debug(action + ': 没找到在跑的桌宠，跳过');
    return;
  }
  if (action === 'idle' || STATES.has(action)) {
    await send(target, action);
    debug(action + ' → ' + target.origin + (target.token ? '（独立模式）' : '（DSH）'));
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
