'use strict';
/**
 * 导入干员的纯逻辑：认素材文件 → 定片段清单 → 生成宠物包配置。
 *
 * 素材约定：明日方舟基建小人的透明 webm（PRTS 下载的文件名形如「乌尔比安-注目深渊-基建-Relax-x1.webm」，
 * 或者直接叫 Relax.webm）。五个标准动作 Relax / Move / Interact / Sit / Sleep，加上任意个 Special
 * （Special / Special2 / Special (2) …，有几个加几个）。至少要有 Relax；其余缺哪个就少哪段。
 * 只收 webm：gif 没有可靠的透明与帧时长，导出也常有问题。
 *
 * 不碰 Electron 与文件系统，测试直接 require。真正的解码 / 对齐 / 编码在 importer/page.js。
 * @module dsh-pet/runtime/electron-helper/importer/plan
 */
const path = require('node:path');

/** 输出帧率：与内置素材一致。 */
const FPS = 30;

/** 标准动作（素材文件里的英文名）。 */
const ROLES = ['Relax', 'Move', 'Interact', 'Sit', 'Sleep'];

/** 事件副本后缀：插件按名字判断「是不是事件动画」，事件里复用的常规动画要换一份不同名的副本。 */
const EVENT_SUFFIX = '·事件';

/** 起来 / 睡醒的过渡段：只留开头几帧，然后硬切回站姿（与游戏里一样）。 */
const GET_UP_FRAMES = 6;

/** 转身：待机开头几帧正放再倒放，首尾都落在待机第一帧。 */
const TURN_FRAMES = 8;

/** 三种走路长度的目标时长（秒），按走路一圈的时长取最接近的圈数。 */
const WALK_TARGET_SEC = [3.3, 6.7, 10];
const WALK_NAMES = ['走路-短', '走路', '走路-长'];

/** 插件移动距离的基准宠物宽（shared/constants 的 PET_REF_WIDTH）与动画画布宽。 */
const PET_REF_WIDTH = 462;
const CANVAS_W = 640;

const ROLE_RE = /(?:^|[-_\s])(relax|move|interact|sit|sleep|special)\s*\(?\s*(\d*)\s*\)?(?=$|[-_\s.@])/i;

/**
 * 从选中的文件（或文件夹里的文件）认出各个动作。
 *
 * @param {string[]} files - 绝对路径；非 webm 一律忽略。
 * @param {string} [folderName] - 选的是文件夹时它的名字（文件名里认不出角色名时用）。
 * @returns {{ ok: true, name: string, id: string, roles: Record<string, string>, extras: { anim: string, file: string }[], ignored: string[] }
 *   | { ok: false, error: string }}
 */
function parseSources(files, folderName) {
  const roles = {};
  const specials = [];
  const ignored = [];
  const prefixes = [];
  for (const file of files) {
    const base = path.basename(file);
    if (!/\.webm$/i.test(base)) {
      ignored.push(base);
      continue;
    }
    const stem = base.replace(/\.webm$/i, '');
    const m = ROLE_RE.exec(stem);
    if (!m) {
      ignored.push(base);
      continue;
    }
    const role = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    prefixes.push(stem.slice(0, m.index));
    if (role === 'Special') {
      specials.push({ n: m[2] === '' ? 1 : Number(m[2]), file });
    } else if (!roles[role]) {
      roles[role] = file;
    } else {
      ignored.push(base);
    }
  }
  if (!roles.Relax) {
    return {
      ok: false,
      error: '没找到待机动作（文件名里要有 Relax，例如「xx-基建-Relax-x1.webm」）。只支持透明 webm。',
    };
  }
  specials.sort((a, b) => a.n - b.n);
  const extras = specials.map((s, i) => ({ anim: '特别动作' + (i === 0 ? '' : String(i + 1)), file: s.file }));
  const name = characterName(prefixes, folderName);
  return { ok: true, name, id: petIdFor(name), roles, extras, ignored };
}

/** 角色名：取文件名里动作前面的部分（去掉「-基建-」与「默认」皮肤名），认不出就用文件夹名。 */
function characterName(prefixes, folderName) {
  let raw = prefixes.find((p) => p.replace(/[-_\s]/g, '') !== '') || '';
  raw = raw.replace(/[-_\s]*基建[-_\s]*$/, '').replace(/[-_\s]+$/, '');
  if (!raw && folderName) raw = folderName;
  const parts = raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .filter((p, i) => !(i > 0 && p === '默认'));
  return parts.join('·') || '新干员';
}

/** 宠物包 id（也是文件名前缀、素材 URL 的一段）：纯 ASCII 名字直接用，否则用名字的短哈希。 */
function petIdFor(name) {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii && /^[\x20-\x7e]+$/.test(name)) return ascii;
  // FNV-1a 32 位：同一个名字每次都得到同一个 id，重复导入就是覆盖更新
  let h = 0x811c9dc5;
  for (const ch of name) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'op-' + h.toString(16).padStart(8, '0');
}

/**
 * 片段清单：每一项是一个要编码的视频，names 是它要写出的所有文件名（同一画面的多份副本共用一次编码）。
 *
 * @param {{ roles: Record<string, string>, extras: { anim: string }[] }} parsed - parseSources 的结果。
 * @param {Record<string, number>} frameCounts - 每个素材按 FPS 取帧后的帧数（键 = 动作英文名或额外动作名）。
 * @returns {{ src: string, rng: [number, number] | null, repeat: number, pingpong: boolean, names: string[], walk?: boolean }[]}
 */
function planClips(parsed, frameCounts) {
  const has = (r) => Boolean(parsed.roles[r]) && frameCounts[r] > 0;
  const clip = (src, names, o = {}) => ({
    src,
    rng: o.rng || null,
    repeat: o.repeat || 1,
    pingpong: Boolean(o.pingpong),
    names,
    ...(o.walk ? { walk: true } : {}),
  });
  const out = [clip('Relax', ['待机', '待机' + EVENT_SUFFIX])];
  out.push(clip('Relax', ['转身'], { rng: [0, Math.min(TURN_FRAMES, frameCounts.Relax)], pingpong: true }));
  if (has('Move')) {
    const cycle = frameCounts.Move / FPS;
    let last = 0;
    WALK_TARGET_SEC.forEach((t, i) => {
      const n = Math.max(last + 1, Math.round(t / cycle));
      last = n;
      out.push(clip('Move', [WALK_NAMES[i]], { repeat: n, walk: true }));
    });
  }
  if (has('Interact')) out.push(clip('Interact', ['互动', '互动' + EVENT_SUFFIX]));
  if (has('Sit')) {
    out.push(clip('Sit', ['坐下', '坐下-开始', '坐下-循环']));
    out.push(clip('Sit', ['坐下-起来'], { rng: [0, Math.min(GET_UP_FRAMES, frameCounts.Sit)] }));
  }
  if (has('Sleep')) {
    out.push(clip('Sleep', ['睡觉-开始', '睡觉-循环']));
    out.push(clip('Sleep', ['睡觉-起来'], { rng: [0, Math.min(GET_UP_FRAMES, frameCounts.Sleep)] }));
  }
  parsed.extras.forEach((x, i) => {
    if (!(frameCounts[x.anim] > 0)) return;
    out.push(clip(x.anim, i === 0 ? [x.anim, x.anim + EVENT_SUFFIX] : [x.anim]));
  });
  return out;
}

/** 片段帧数（含重复与正倒放），用于算时长。 */
function clipFrameCount(c, frameCounts) {
  const n = c.rng ? c.rng[1] - c.rng[0] : frameCounts[c.src];
  return (c.pingpong ? n + Math.max(0, n - 1) : n) * c.repeat;
}

/**
 * 生成 <id>-config.json 的内容：动作权重与状态沿用空弦 / 乌尔比安调好的默认值。
 *
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.name
 * @param {Set<string>} o.built - 实际写出的动画名。
 * @param {{ name: string, sec: number }[]} o.walks - 走路片段与时长。
 * @param {number} o.walkSpeed - 走路时着地脚的速度（画布 px/帧 @30fps），0 = 没测出来。
 * @param {string[]} o.extras - 额外动作名（特别动作…）。
 * @returns {object}
 */
function buildPackConfig({ id, name, built, walks, walkSpeed, extras }) {
  const have = (n) => built.has(n);
  const ev = (n, fallback) => (have(n) ? n : fallback);
  const tap = have('互动' + EVENT_SUFFIX) ? '互动' + EVENT_SUFFIX : '待机' + EVENT_SUFFIX;
  const sitting = have('坐下-开始') && have('坐下-循环') && have('坐下-起来');
  const extraList = extras.filter(have);
  const firstExtra = extraList.length ? extraList[0] + EVENT_SUFFIX : tap;

  const pxPerSec = (walkSpeed || 2) * FPS * (PET_REF_WIDTH / CANVAS_W);
  const moveActions = walks
    .filter((w) => have(w.name))
    .map((w) => {
      const dist = Math.round(pxPerSec * w.sec);
      return { name: w.name, params: { minDist: dist, maxDist: dist, leadSec: 0, tailSec: 0 } };
    });

  const categories = [];
  if (sitting) categories.push({ id: '坐', weight: 37, actions: ['坐着'] });
  if (have('互动')) categories.push({ id: '互动', weight: 7, actions: ['互动'] });
  if (extraList.length) categories.push({ id: '特别', weight: 1, splitAcrossCopies: true, actions: extraList });

  const animations = {
    idle: ['待机'],
    turn: have('转身') ? ['转身'] : [],
    drag: [],
    clicks: have('互动') ? ['互动'] : [],
    moves: {
      default: { minDist: 80, maxDist: 220, margin: 20, leadSec: 0, tailSec: 0, wanderRange: 300 },
      actions: moveActions,
    },
    categories,
    events: {
      balance: [tap, tap, tap, tap, ev('坐下', tap), ev('坐下', tap)],
      whisper: [tap],
      workStatus: ['待机' + EVENT_SUFFIX, firstExtra, tap, sitting ? '坐着' : tap, tap, ev('坐下', tap)],
    },
  };
  if (have('睡觉-开始') && have('睡觉-循环') && have('睡觉-起来')) {
    animations.sleep = [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }];
  }
  if (sitting) {
    animations.states = [
      { name: '坐着', enter: ['坐下-开始'], loop: ['坐下-循环'], exit: ['坐下-起来'], minLoops: 2, maxLoops: 5 },
    ];
  }
  return {
    pets: [
      {
        id,
        name,
        size: 360,
        balanceEnabled: false,
        whisperEnabled: false,
        workStatusEnabled: false,
        fixedEnabled: false,
        display: 'desktop',
        position: { corner: 'top-right', marginX: 24, marginY: 700 },
        autoSleepMinutes: 10,
      },
    ],
    animations,
    animationWeights: { idle: 25, turn: 10, move: moveActions.length ? 20 : 0 },
  };
}

/**
 * 从走路片段的透明通道反推走路速度：着地的那只脚应在屏幕上不动（与 kongxian-pet/build.py 同一算法）。
 *
 * 取脚底那一条（地面线上方 10px）里每只鞋的左右边缘，对候选速度 v 统计「这一帧的边缘平移 v 后正好落在
 * 下一帧某条边缘上」的次数，取最多的那个。整段几乎不动的边缘（拖在地上的尾巴、飘带）先剔除。
 *
 * @param {boolean[][]} bands - 每帧一行：该列在脚底带里是否有不透明像素。
 * @returns {number} 画布 px/帧；测不出返回 0。
 */
function measureWalkSpeed(bands) {
  const edges = bands.map((row) => {
    const xs = [];
    row.forEach((on, x) => {
      if (on) xs.push(x);
    });
    const segs = [];
    let cur = [];
    for (const x of xs) {
      if (cur.length && x - cur[cur.length - 1] > 3) {
        segs.push(cur);
        cur = [];
      }
      cur.push(x);
    }
    if (cur.length) segs.push(cur);
    return segs.filter((s) => s.length > 4).flatMap((s) => [s[0], s[s.length - 1]]);
  });
  const counts = new Map();
  for (const e of edges) for (const x of e) counts.set(x, (counts.get(x) || 0) + 1);
  const isStatic = (x) => [-1, 0, 1].some((d) => (counts.get(x + d) || 0) > 0.5 * edges.length);
  const moving = edges.map((e) => e.filter((x) => !isStatic(x)));
  let best = { still: 0, v: 0 };
  for (let i = 0; i <= 100; i++) {
    const v = 1 + i * 0.05;
    let still = 0;
    for (let f = 0; f + 1 < moving.length; f++) {
      const a = moving[f];
      const b = moving[f + 1];
      if (!a.length || !b.length) continue;
      for (const x of a) if (b.some((y) => Math.abs(x + v - y) < 0.6)) still++;
    }
    if (still >= best.still && still > 0) best = { still, v: Math.round(v * 100) / 100 };
  }
  return best.v;
}

module.exports = {
  FPS,
  ROLES,
  EVENT_SUFFIX,
  parseSources,
  petIdFor,
  planClips,
  clipFrameCount,
  buildPackConfig,
  measureWalkSpeed,
};
