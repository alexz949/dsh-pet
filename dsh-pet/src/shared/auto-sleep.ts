/**
 * 没人理就自己去睡（pets[].autoSleepMinutes）：纯判定，计时与发请求在各端。
 *
 * 「有人理」= 点 / 拖宠物、打开对话、DSH 开始干活（工作状态进入非终态）。连续这么多分钟都没有，
 * 就走与右键「睡觉」同一条请求（宿主挑睡姿、写回 sleep 叶子），所以表现与手动入睡完全一致。
 * 自己睡着的宠物在 DSH 再次开始干活时会自己醒来；被手动哄睡的不受影响，照旧点一下才醒。
 * @module dsh-pet/src/shared/auto-sleep
 */

/** 各端轮询判定的间隔（ms）：分钟级的阈值，15 秒的误差足够小。 */
export const AUTO_SLEEP_CHECK_MS = 15_000;

/** 判定输入。 */
export interface AutoSleepInput {
  /** pets[].autoSleepMinutes；缺省 / 0 / 非法 = 关闭。 */
  minutes: number | undefined;
  /** 最近一次「有人理」的时刻（ms）。 */
  lastActiveAt: number;
  /** 现在（ms）。 */
  now: number;
  /** 已在睡（含入睡 / 醒来过渡）。 */
  sleeping: boolean;
  /** 被占用锁冻住：冻结期间什么都不自己做。 */
  frozen: boolean;
  /** 正被按着拖拽。 */
  dragging: boolean;
  /** 该条目配了睡觉动作（animations.sleep 非空）；没配就没法睡。 */
  hasSleep: boolean;
}

/**
 * 现在是否该自己去睡。
 * @param o - 判定输入。
 * @returns true = 发一次进睡请求。
 */
export function shouldAutoSleep(o: AutoSleepInput): boolean {
  const minutes = typeof o.minutes === 'number' && Number.isFinite(o.minutes) ? o.minutes : 0;
  if (minutes <= 0 || !o.hasSleep) return false;
  if (o.sleeping || o.frozen || o.dragging) return false;
  return o.now - o.lastActiveAt >= minutes * 60_000;
}

/**
 * 工作状态算不算「主人在忙」：非终态（thinking / working / waiting 等）算，空闲与终态不算。
 * @param state - 工作状态；null / undefined = 空闲。
 */
export function isWorkBusy(state: string | null | undefined): boolean {
  return state !== null && state !== undefined && state !== 'success' && state !== 'error';
}

/**
 * 校验 pets[].autoSleepMinutes：写了就必须是非负有限数字（0 = 关闭）。
 * @param value - 原始值。
 */
export function isValidAutoSleepMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
