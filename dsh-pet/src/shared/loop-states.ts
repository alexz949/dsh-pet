/**
 * 循环状态：「进入 → 循环若干遍 → 退出」的动作（坐下坐一会儿再站起来、蹲下玩一会儿……）。
 *
 * 与睡觉同一种三段结构，区别是不等人叫醒：循环遍数在 [minLoops, maxLoops] 里随机，播完自己退出回随机链。
 * 触发方式：状态名出现在哪里，哪里就能触发——把它写进 categories 的 actions 就会被随机链抽到，
 * 菜单点播、/anim 与对话联动同理。播放端在换源入口识别状态名，换成进入段去播。
 *
 * 「保持」模式：状态被当成循环来播（工作状态的进行中档位，如「等你确认」）时，循环段不计遍数、
 * 一直循环，直到有别的动画要播——那时先播退出段（站起来）再播那个动画，而不是硬切。
 *
 * 本模块只有纯函数：选段、掷遍数、推进一步。播放与打断由桌面 / 浏览器两端各自处理。
 * @module dsh-pet/src/shared/loop-states
 */
import { pick } from './pickers.ts';

/** 一个循环状态（animations.states 的一项）。 */
export interface LoopState {
  /** 状态名：写在 categories / 菜单里的就是它，不对应素材文件。 */
  name: string;
  /** 进入段候选（播一遍）。 */
  enter: string[];
  /** 循环段候选（每遍重新抽一个，避开刚播完的）。 */
  loop: string[];
  /** 退出段候选（播一遍，播完回随机链）。 */
  exit: string[];
  /** 循环段最少播几遍（≥0；0 = 进入后直接退出）。 */
  minLoops: number;
  /** 循环段最多播几遍（≥ minLoops）。 */
  maxLoops: number;
}

/** 一次状态的进行中记录。 */
export interface LoopStateRun {
  state: LoopState;
  phase: 'enter' | 'loop' | 'exit';
  /** 进入循环段后还剩几遍（含正在播的这一遍）；进入段时为 0。 */
  loopsLeft: number;
  /** 当前这一段的素材名：播放端据此判断 ended 是不是这一段的（不是就说明被打断了）。 */
  clip: string;
  /** 保持模式：循环段一直循环，直到被 releaseLoopState 放开（见模块说明）。 */
  hold: boolean;
}

/**
 * 按名字找状态。
 * @param states - animations.states；缺省 / 非数组按没有处理。
 * @param name - 要播的名字。
 * @returns 同名状态；没有则 null。
 */
export function findLoopState(states: readonly LoopState[] | undefined, name: string): LoopState | null {
  if (!Array.isArray(states)) return null;
  return states.find((s) => s.name === name) ?? null;
}

/**
 * 掷循环遍数：[minLoops, maxLoops] 闭区间内的整数。
 * @param state - 状态。
 * @param roll - 0~1 随机数（测试可注入）。
 */
export function rollLoopCount(state: LoopState, roll: number = Math.random()): number {
  const lo = Math.max(0, Math.floor(state.minLoops));
  const hi = Math.max(lo, Math.floor(state.maxLoops));
  return Math.min(hi, lo + Math.floor(roll * (hi - lo + 1)));
}

/**
 * 开始一次状态：先播进入段。
 * @param state - 状态。
 * @param hold - 保持模式（循环段一直循环直到被放开）；缺省 false = 按遍数自己退出。
 * @returns 进行中记录；clip 就是要播的进入段。
 */
export function startLoopState(state: LoopState, hold = false): LoopStateRun {
  return { state, phase: 'enter', loopsLeft: 0, clip: pick(state.enter), hold };
}

/**
 * 放开保持中的状态：直接转到退出段（站起来）。已在退出段的原样返回。
 * @param run - 进行中记录。
 * @returns 退出段的记录（不再保持）。
 */
export function releaseLoopState(run: LoopStateRun): LoopStateRun {
  if (run.phase === 'exit') return { ...run, hold: false };
  return { state: run.state, phase: 'exit', loopsLeft: 0, clip: pick(run.state.exit), hold: false };
}

/**
 * 当前段播完，推进一步。
 * @param run - 进行中记录。
 * @param roll - 掷循环遍数用的随机数（只在进入段 → 循环段时用到）。
 * @returns 下一段的记录；退出段播完返回 null（状态结束，回随机链）。
 */
export function advanceLoopState(run: LoopStateRun, roll: number = Math.random()): LoopStateRun | null {
  const { state, hold } = run;
  if (run.phase === 'exit') return null;
  // 保持模式：进入后一直循环，不计遍数
  if (hold)
    return {
      state,
      phase: 'loop',
      loopsLeft: 0,
      clip: pick(state.loop, run.phase === 'loop' ? run.clip : undefined),
      hold,
    };
  if (run.phase === 'enter') {
    const loops = rollLoopCount(state, roll);
    if (loops <= 0) return { state, phase: 'exit', loopsLeft: 0, clip: pick(state.exit), hold };
    return { state, phase: 'loop', loopsLeft: loops, clip: pick(state.loop, run.clip), hold };
  }
  // 循环段：还有剩余遍数就再来一遍，否则退出
  if (run.loopsLeft > 1)
    return { state, phase: 'loop', loopsLeft: run.loopsLeft - 1, clip: pick(state.loop, run.clip), hold };
  return { state, phase: 'exit', loopsLeft: 0, clip: pick(state.exit), hold };
}

/**
 * 配置校验：animations.states 写了就必须是合法的状态数组。
 * @param value - 原始配置值。
 * @returns 合法返回 true（未写由调用方放行）。
 */
export function loopStatesValid(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const names = new Set<string>();
  for (const s of value) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const st = s as Record<string, unknown>;
    if (typeof st.name !== 'string' || st.name === '' || names.has(st.name)) return false;
    names.add(st.name);
    for (const phase of ['enter', 'loop', 'exit']) {
      const pool = st[phase];
      if (!Array.isArray(pool) || pool.length === 0) return false;
      if (!pool.every((n) => typeof n === 'string' && n !== '')) return false;
    }
    const lo = st.minLoops;
    const hi = st.maxLoops;
    if (typeof lo !== 'number' || !Number.isInteger(lo) || lo < 0) return false;
    if (typeof hi !== 'number' || !Number.isInteger(hi) || hi < lo) return false;
  }
  return true;
}
