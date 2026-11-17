'use strict';
/**
 * 「追加动作」的纯逻辑：认战斗小人的动作文件 → 片段清单 → 合进已有宠物包配置。
 *
 * 文件名按 PRTS 的写法：「维什戴尔-绝对主角-正面-Skill_3_Begin-x1.webm」，动作名取朝向（正面 / 背面）
 * 或「基建」后面那一段；直接叫「Attack.webm」也行。识别规则：
 *   - 同一个技能有 Begin + Loop（或 Idle）+ End → 组成循环状态：起手 → 在 Loop / Idle 里循环几遍 → 收招
 *   - Start 是出场动作：写进 animations.start，宠物出现在桌面上时先播一次，不进随机链
 *   - 其余每个文件是一个单独动作（Attack、Attack_B、Skill_1…）
 * 名字转成中文显示：Attack_B → 攻击B，Skill_2_Overload → 技能2·过载，Start → 出场。
 *
 * 不碰 Electron 与文件系统，测试直接 require。
 * @module dsh-pet/runtime/electron-helper/importer/skills
 */
const path = require('node:path');

/** 事件副本后缀：事件里复用的常规动画要换一份不同名的副本（插件按名字判断事件动画，见 importer/plan.js）。 */
const EVENT_SUFFIX = '·事件';
/** 干活时开打的档位（events.workStatus 下标）：思考 0、调用工具 1、整理结果 2；等待确认 3 仍坐着，完成 / 出错照旧。 */
const FIGHT_SLOTS = [0, 1, 2];
const WORK_SLOTS = 6;
/** 随机放技能时一整套（起手 → 循环 → 收招）的目标时长（秒）；循环遍数按片段长度算，上下浮动一遍 */
const SKILL_TARGET_SEC = 20;

/** 追加动作统一进这个分类（随机链里的份额默认 1，按分身数平分）。 */
const SKILL_CATEGORY = '技能';
const SKILL_WEIGHT = 1;

/** 技能分段后缀 → 显示用的段名 */
const PHASES = { Begin: '起手', Loop: '攻击', Idle: '架势', End: '收招' };

/** 动作名里的英文词 → 中文 */
const WORDS = {
  Attack: '攻击',
  Skill: '技能',
  Start: '出场',
  Overload: '过载',
  Die: '倒下',
  Idle: '待机',
  Move: '移动',
  Default: '默认',
};

/** 从文件名取动作名：朝向（正面 / 背面）或「基建」后面那一段；都没有就用整个文件名。 */
function actionOf(file) {
  const stem = path.basename(file).replace(/\.webm$/i, '');
  const parts = stem.split('-');
  const at = parts.findIndex((p) => p === '正面' || p === '背面' || p === '基建');
  const raw = at >= 0 && parts[at + 1] ? parts[at + 1] : stem.replace(/-x\d+(@\dx)?$/i, '');
  return raw.trim();
}

/** Attack_B → 攻击B；Skill_2_Overload → 技能2·过载；认不出的词原样保留。 */
function displayName(raw) {
  const tokens = raw.split(/[_\s]+/).filter(Boolean);
  const out = [];
  for (const t of tokens) {
    const word = WORDS[t] || t;
    const prev = out[out.length - 1];
    // 数字和单个字母（B / 2）紧贴前一个词，其余用「·」隔开
    if (prev !== undefined && /^([0-9]+|[A-Z])$/.test(t)) out[out.length - 1] = prev + word;
    else out.push(word);
  }
  return out.join('·') || raw;
}

/**
 * 认文件。
 *
 * @param {string[]} files - 绝对路径；非 webm 忽略。
 * @param {Set<string>} [taken] - 宠物包里已有的动画名（追加的名字避开它们，重名的加「·追加」）。
 * @returns {{ ok: true, singles: { key: string, name: string, file: string }[],
 *   states: { name: string, enter: string, loop: string[], exit: string, files: Record<string, string> }[],
 *   start: { key: string, name: string, file: string } | null, ignored: string[] } | { ok: false, error: string }}
 *   key = 编码用的素材键（文件里的动作名），name / enter / loop / exit 是写进宠物包的动画名。
 */
function parseSkillFiles(files, taken = new Set()) {
  const byAction = new Map();
  const ignored = [];
  for (const file of files) {
    if (!/\.webm$/i.test(file)) {
      ignored.push(path.basename(file));
      continue;
    }
    const action = actionOf(file);
    if (!action || byAction.has(action)) {
      ignored.push(path.basename(file));
      continue;
    }
    byAction.set(action, file);
  }
  if (!byAction.size) return { ok: false, error: '没有可用的 webm（只支持透明 webm）。' };

  const used = new Set(taken);
  const unique = (name) => {
    let n = name;
    while (used.has(n)) n += '·追加';
    used.add(n);
    return n;
  };

  // 分段技能：同一个前缀下有 Begin + End，且至少有 Loop 或 Idle
  const grouped = new Set();
  const states = [];
  const prefixes = new Set();
  for (const a of byAction.keys()) {
    const m = /^(.*)_(Begin|Loop|Idle|End)$/.exec(a);
    if (m) prefixes.add(m[1]);
  }
  for (const p of prefixes) {
    const has = (ph) => byAction.has(p + '_' + ph);
    if (!(has('Begin') && has('End') && (has('Loop') || has('Idle')))) continue;
    const base = unique(displayName(p));
    const clip = (ph) => unique(base + '-' + PHASES[ph]);
    const st = { name: base, enter: clip('Begin'), loop: [], exit: '', files: {} };
    st.files[st.enter] = byAction.get(p + '_Begin');
    for (const ph of ['Loop', 'Idle']) {
      if (!has(ph)) continue;
      const n = clip(ph);
      st.loop.push(n);
      st.files[n] = byAction.get(p + '_' + ph);
    }
    st.exit = clip('End');
    st.files[st.exit] = byAction.get(p + '_End');
    for (const ph of ['Begin', 'Loop', 'Idle', 'End']) grouped.add(p + '_' + ph);
    states.push(st);
  }
  const singles = [];
  let start = null;
  for (const [action, file] of byAction) {
    if (grouped.has(action)) continue;
    const item = { key: action, name: unique(displayName(action)), file };
    if (action === 'Start') start = item;
    else singles.push(item);
  }
  return { ok: true, singles, states, start, ignored };
}

/**
 * 循环遍数：(目标时长 − 起手 − 收招) ÷ 循环段平均时长，四舍五入，上下浮动一遍；不知道时长就 1–3 遍。
 * 工作状态里放技能是保持模式（一直循环到这一轮结束），不受它限制。
 */
function skillLoops(st, durations) {
  const sec = (n) => Number(durations[n]) || 0;
  const avg = st.loop.reduce((s, n) => s + sec(n), 0) / Math.max(1, st.loop.length);
  if (!(avg > 0)) return { min: 1, max: 3 };
  const n = Math.max(1, Math.round((SKILL_TARGET_SEC - sec(st.enter) - sec(st.exit)) / avg));
  return { min: Math.max(1, n - 1), max: n + 1 };
}

/** 编码用的素材清单与片段清单（素材键 = 写出的动画名，每个文件编一次）。 */
function skillSourcesAndClips(parsed) {
  const sources = [];
  for (const s of parsed.singles) sources.push({ key: s.name, file: s.file });
  if (parsed.start) sources.push({ key: parsed.start.name, file: parsed.start.file });
  for (const st of parsed.states)
    for (const [name, file] of Object.entries(st.files)) sources.push({ key: name, file });
  // 单个攻击 / 技能还要进工作状态的「工作」档：多写一份「·事件」副本（同一次编码）
  const singleNames = new Set(parsed.singles.map((s) => s.name));
  const clips = sources.map((s) => ({
    src: s.key,
    rng: null,
    repeat: 1,
    pingpong: false,
    names: singleNames.has(s.key) ? [s.key, s.key + EVENT_SUFFIX] : [s.key],
  }));
  return { sources, clips };
}

/**
 * 把追加的动作合进宠物包配置（不改入参）：单个动作与技能状态名进「技能」分类，技能状态进 animations.states。
 * 再次追加同名的会替换旧的那条。
 *
 * @param {object} config - 宠物包配置。
 * @param {ReturnType<typeof parseSkillFiles>} parsed
 * @param {Set<string>} built - 实际编码写出的动画名。
 * @param {Record<string, number>} [durations] - 动画名 → 时长（秒），用来把一整套技能凑到约 SKILL_TARGET_SEC。
 * @returns {object}
 */
function mergeSkillConfig(config, parsed, built, durations = {}) {
  const a = { ...(config.animations || {}) };
  const singles = parsed.singles.filter((s) => built.has(s.name)).map((s) => s.name);
  const states = parsed.states
    .filter((st) => built.has(st.enter) && built.has(st.exit) && st.loop.every((n) => built.has(n)))
    .map((st) => {
      const loops = skillLoops(st, durations);
      return {
        name: st.name,
        enter: [st.enter],
        loop: st.loop,
        exit: [st.exit],
        minLoops: loops.min,
        maxLoops: loops.max,
      };
    });
  const added = [...singles, ...states.map((s) => s.name)];
  const stateNames = new Set(states.map((s) => s.name));
  a.states = [...(a.states || []).filter((s) => !stateNames.has(s.name)), ...states];
  if (!a.states.length) delete a.states;
  const cats = (a.categories || []).map((c) => ({ ...c }));
  let home = cats.find((c) => c.id === SKILL_CATEGORY);
  if (!home) {
    home = { id: SKILL_CATEGORY, weight: SKILL_WEIGHT, splitAcrossCopies: true, actions: [] };
    cats.push(home);
  }
  home.actions = [...home.actions.filter((n) => !added.includes(n)), ...added];
  a.categories = cats.filter((c) => c.actions.length);
  // 出场动作：宠物出现在桌面上时先播一次（见 renderer.js），不进随机链
  if (parsed.start && built.has(parsed.start.name)) a.start = [parsed.start.name];
  // 干活时打：思考 / 调用工具 / 整理结果三档（Claude Code / Codex / DSH 干活的整段）换成攻击与技能，候选里随机取；
  // 技能状态在进行中档位按保持模式播（一直循环到工作结束再收招）。这个包的宠物打开工作状态联动。
  const workPool = [
    ...singles.filter((n) => built.has(n + EVENT_SUFFIX)).map((n) => n + EVENT_SUFFIX),
    ...states.map((s) => s.name),
  ];
  let pets = config.pets;
  if (workPool.length) {
    const events = { ...(a.events || {}) };
    const ws = Array.isArray(events.workStatus) ? events.workStatus.slice() : [];
    const fallback = (a.idle && a.idle[0]) || workPool[0];
    while (ws.length < WORK_SLOTS) ws.push(fallback);
    for (const i of FIGHT_SLOTS) ws[i] = workPool.length === 1 ? workPool[0] : workPool.slice();
    events.workStatus = ws;
    a.events = events;
    if (Array.isArray(pets)) pets = pets.map((p) => ({ ...p, workStatusEnabled: true }));
  }
  return { ...config, pets, animations: a };
}

module.exports = {
  SKILL_TARGET_SEC,
  skillLoops,
  SKILL_CATEGORY,
  actionOf,
  displayName,
  parseSkillFiles,
  skillSourcesAndClips,
  mergeSkillConfig,
};
