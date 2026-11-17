/**
 * 自播动画链：A/B 双缓冲换源、blob 生命周期、点播回执，以及「这一段播完之后该做什么」的判定。
 *
 * 只碰 video 元素与自己的内部状态；React 状态（anim / once / seq / 气泡 / 朝向）不在本模块里改，
 * 需要改的地方以 {@link EndedCue} / {@link FreezeCue} 的形式返回，由组件执行。
 * 必须始终成立：同一时刻只有一个 pending 换源（世代号丢弃迟到的加载），且回执先于任何 return 上报。
 * @module dsh-pet/src/client/pet/animation/animation
 */
import { isEventAnim } from '../../../shared/pickers.ts';
import {
  advanceLoopState,
  findLoopState,
  releaseLoopState,
  startLoopState,
  type LoopStateRun,
} from '../../../shared/loop-states.ts';
import { decideEndedCue, type EndedCue, type FreezeCue } from './cues.ts';
import type { ReportableStatus } from '../../../shared/playback.ts';
import type { Animations } from '../../../shared/types.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import { createAssetLoader, type AssetLoader } from './asset-loader.ts';
import { animationAssetUrl } from './assets.ts';
import { thumbExt } from './media.ts';

export type { EndedCue, FreezeCue };

/** 换源失败与打断的原因，落进回执的 `reason` 字段。 */
const REASON_ASSET_LOAD = 'asset-load';
const REASON_PLAY_REJECTED = 'play-rejected';
const REASON_DECODE = 'decode-error';
const REASON_SUPERSEDED = 'superseded';
const REASON_FROZEN = 'frozen';

/** 资源超时（ms）：DSH WebServer 偶发 stalled，超时就丢弃本次换源。 */
const ASSET_FETCH_TIMEOUT_MS = 10_000;

/** 前台 class（样式见 ../css.ts）。 */
const FRONT_CLASS = 'is-front';
/** 新段首帧回调最多等多久就直接换（ms）：标签页在后台等情况下帧回调可能不来。 */
const SWAP_FALLBACK_MS = 120;
/** 一次性段剩这么多秒时就提前收尾、预载下一段，消除换段时停在末帧的那一下。 */
const PREROLL_SEC = 0.35;

/** 带帧回调的 video：Chromium / Safari 有，jsdom 与老浏览器没有。 */
type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

/**
 * 硬切换段：新段首帧真正出画后，同一刻把它设为前台、旧段降为后台并停播。
 *
 * 不在 loadeddata 时直接换（新段还没画出第一帧会闪空白），不做透明度过渡（两层半透明叠加时
 * 宠物整体只有约 75% 不透明，像闪烁）。后台视频保持 1% 不透明（../css.ts），一直在合成层里，
 * 翻到前台的第一帧就有画面，所以不让旧段垫底——垫底在中途打断时会和新段叠出重影。
 * @param el - 新段。
 * @param outgoing - 旧段；与 el 相同或为空时只设前台。
 * @param isStillFront - 换的那一刻新段是否仍是前台；被更新的换段抢先时这次作废。
 */
function presentSwap(el: HTMLVideoElement, outgoing: HTMLVideoElement | null, isStillFront: () => boolean): void {
  let done = false;
  const swap = (): void => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    if (!isStillFront()) return;
    el.classList.add(FRONT_CLASS);
    if (outgoing !== null && outgoing !== el) {
      outgoing.classList.remove(FRONT_CLASS);
      outgoing.pause();
    }
  };
  const fallback = setTimeout(swap, SWAP_FALLBACK_MS);
  const fv = el as FrameVideo;
  if (typeof fv.requestVideoFrameCallback === 'function') fv.requestVideoFrameCallback(swap);
  else swap();
}

/** 日志时间戳：与其余宠物日志同一格式，便于对照同一次事件。 */
const stamp = (petId: string): string => new Date().toTimeString().slice(0, 8) + ' pet=' + petId;

/** 挂起的换源：世代号用于丢弃迟到的加载结果。 */
interface PendingSwap {
  anim: string;
  once: boolean;
  gen: number;
}

/** 动画链的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface OwnAnimationDeps {
  /** A/B 双缓冲的 A 元素。 */
  videoA: () => HTMLVideoElement | null;
  /** A/B 双缓冲的 B 元素。 */
  videoB: () => HTMLVideoElement | null;
  /** 该宠物的成品配置：素材根、id 与动画池都从它取。 */
  cfg: () => { id: string; assetRoot?: string; animations: Animations };
  /** 当前动画名。 */
  currentAnim: () => string;
  /** 工作状态叶子；未启用联动时为空。 */
  workStatus: () => WorkStatusSnapshot | null | undefined;
  /** 当前朝向，决定镜像。 */
  facing: () => 'left' | 'right';
  /** 上报第三方点播的真实状态。 */
  report: (playbackId: string, status: ReportableStatus, reason?: string) => void;
  /** 消费掉点播编号（清 React 状态，避免 effect 再跑一趟）。 */
  clearCuePlayback: () => void;
  /** 新动画已就位：组件在这里补 Q 弹与走位驱动。 */
  onFrontReady: (el: HTMLVideoElement) => void;
  /** 前台播完的判定结果；组件据此改 React 状态。 */
  onEnded: (cue: EndedCue) => void;
  /** 用户是否正按着宠物（拖拽期间不推进动画链）。 */
  isDragging: () => boolean;
  /** 挂载那一刻是否已被锁冻住。 */
  initiallyFrozen: boolean;
  /** 素材加载器；缺省用带超时的默认实现。 */
  loader?: AssetLoader;
}

/** 动画链对外能力。 */
export interface OwnAnimation {
  /** 换源播放；`cuePlaybackId` 非空表示这是一次第三方点播，要回执。 */
  switchTo: (next: string, once: boolean, cuePlaybackId: string | null) => void;
  /** 前台播完的判定；回执在这里上报，React 状态由组件按 cue 改。 */
  handleEnded: (event?: Event) => EndedCue;
  /** 把前台的循环关掉并挂上 ended：正在循环的档位动画靠它播完即停。 */
  stopLoopingFront: () => void;
  /** 交接下一次换源要用的完整地址（第三方点播的 url 形态）。 */
  setCueUrl: (url: string) => void;
  /** 冻结/解冻；只做播放控制与回执，气泡与动画选择交给组件。 */
  setFrozen: (next: boolean) => FreezeCue | null;
  /** 当前是否冻结（随机链与自动来源的门禁）。 */
  isFrozen: () => boolean;
  /** 前台元素；进度服务读它。 */
  frontVideo: () => HTMLVideoElement | null;
  /** 正在播的点播编号；自播动画为 `null`。 */
  playingPlayback: () => string | null;
  /** 卸载清理：中断在途请求、释放 blob，之后不可再用。 */
  dispose: () => void;
}

/**
 * 造动画链。
 *
 * @param deps - 元素、配置与回调。
 * @returns 换源、播完判定、冻结控制与清理。
 */
export function createOwnAnimation(deps: OwnAnimationDeps): OwnAnimation {
  /** 当前前台槽位：0 = A，1 = B。 */
  let front = 0;
  /** 挂起的换源；`null` = 没有换源在等首帧。 */
  let pending: PendingSwap | null = null;
  /** 换源世代号，只增不减。 */
  let gen = 0;
  /** 待消费的点播地址，一次性取走。 */
  let cueUrl: string | null = null;
  /** 正在播的点播编号。 */
  let playing: string | null = null;
  /** 冻结标志：只挡自动来源，显式指令照常。 */
  let frozen = deps.initiallyFrozen;
  /** 两个槽位各自的 blob 地址，换源时先释放旧的。 */
  const blobUrl: { a: string | null; b: string | null } = { a: null, b: null };
  const loader = deps.loader ?? createAssetLoader(ASSET_FETCH_TIMEOUT_MS);
  /** 挂载标志：卸载后迟到的加载结果直接丢弃。 */
  let mounted = true;
  /**
   * 提前收尾的那一段（armPreroll）：它还在播最后零点几秒，下一段加载好后要等它真正播完再开播。
   * `null` = 没有预载在等。
   */
  let preroll: HTMLVideoElement | null = null;
  /**
   * 循环状态（animations.states）的进行中记录；null = 不在状态里。
   * 状态机自己换段时 loopInternal 为真，其余任何换源都视为打断。currentClip = 最近一次真正换源的素材名。
   */
  let loopRun: LoopStateRun | null = null;
  let loopInternal = false;
  let currentClip = '';
  /** 保持中的状态被别的动画请求打断时，那次请求先挂在这里，等退出段（站起来）播完再播。 */
  let afterLoopExit: { next: string; nextOnce: boolean; cuePlaybackId: string | null; url: string | null } | null =
    null;

  const slotOf = (index: number): 'a' | 'b' => (index === 0 ? 'a' : 'b');
  const elementOf = (index: number): HTMLVideoElement | null => (index === 0 ? deps.videoA() : deps.videoB());

  const frontVideo = (): HTMLVideoElement | null => elementOf(front);

  /** 上报并清掉「正在播」的编号；`keep` 为真时不清（同一编号继续播）。 */
  const reportOnce = (playbackId: string, status: ReportableStatus, reason?: string): void => {
    if (playing === playbackId) playing = null;
    deps.report(playbackId, status, reason);
  };

  const switchTo = (next: string, nextOnce: boolean, cuePlaybackId: string | null): void => {
    // 一次性消费点播编号：清空会再跑一趟 effect，那一趟落入防重分支。
    if (cuePlaybackId !== null) deps.clearCuePlayback();
    // url 交接位同样一次性取走，且必须早于任何 return：否则防重分支提前返回时，
    // 它会留到下一次普通换源，把那个动画误播成这个地址。
    const cfg = deps.cfg();
    const url = cueUrl;
    cueUrl = null;
    if (next === '') return;
    // 循环状态：名字是状态名（不是素材）→ 开始这个状态，实际播它的进入段。
    // 入口放在换源这里，随机链 / 菜单点播 / /anim / 对话联动都不用各自识别。
    // 保持中的状态（如「等你确认」时坐着）：别的动画要播时先站起来——放开到退出段，
    // 把这次请求挂起，退出段播完再播它（handleEnded）。同一个状态再被请求则原样保持。
    if (!loopInternal && loopRun?.hold === true) {
      if (next === loopRun.state.name) return;
      afterLoopExit = { next, nextOnce, cuePlaybackId, url };
      releaseHeld();
      return;
    }
    if (url === null) {
      const st = findLoopState(cfg.animations.states, next);
      if (st !== null) {
        // 当循环来播（nextOnce=false：工作状态进行中档位）= 保持模式，一直坐到有别的事
        loopRun = startLoopState(st, !nextOnce);
        playLoopClip(loopRun.clip, cuePlaybackId);
        return;
      }
    }
    // 不是状态机自己发起的换源 = 打断了正在进行的状态
    if (!loopInternal) {
      loopRun = null;
      afterLoopExit = null;
    }
    if (pending !== null && pending.anim === next && pending.once === nextOnce) {
      // 防重命中仍要让点播有回执，避免调用方干等超时。
      if (cuePlaybackId !== null) {
        playing = cuePlaybackId;
        deps.report(cuePlaybackId, 'playing');
      }
      return;
    }
    if (isEventAnim(cfg.animations.events, next)) {
      console.log('[dsh-pet] ' + stamp(cfg.id) + ' switch ' + next + ' once=' + nextOnce);
    }
    const swapGen = (gen += 1);
    pending = { anim: next, once: nextOnce, gen: swapGen };
    currentClip = next;
    const targetIndex = front === 0 ? 1 : 0;
    const el = elementOf(targetIndex);
    if (el === null) return;
    el.loop = !nextOnce;
    el.muted = true;
    // 不自动播：预载时新段要停在首帧等上一段播完，开播统一由 start() 里的 play() 负责。
    // preload=auto 保证不自动播时 loadeddata（首帧可解码）照样会来。
    el.autoplay = false;
    el.preload = 'auto';
    el.playsInline = true;
    el.onended = nextOnce ? (event: Event) => deps.onEnded(handleEnded(event)) : null;
    // 元素级解码失败只补一条回执，不改播放控制；换源时与 onended 一起清掉。
    el.onerror = cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, 'failed', REASON_DECODE);
    // fetch + blob 一次拿全文件，绕开 video 流式加载在 DSH WebServer 上偶发的 stalled。
    const assetUrl = animationAssetUrl({
      cueUrl: url,
      assetRoot: cfg.assetRoot ?? '',
      id: cfg.id,
      anim: next,
      ext: thumbExt(),
    });
    loader.load(assetUrl, {
      onObjectUrl: (objectUrl) => {
        if (!mounted) {
          loader.release(objectUrl); // 已卸载：不留无人回收的地址。
          return;
        }
        if (pending?.gen !== swapGen) {
          loader.release(objectUrl); // 已被更新的切换覆盖：本次加载作废。
          return;
        }
        const slot = slotOf(targetIndex);
        const previous = blobUrl[slot];
        if (previous !== null) loader.release(previous);
        blobUrl[slot] = objectUrl;
        el.src = objectUrl;
        el.load();
      },
      onError: (error) => {
        if (!mounted) return; // 卸载后的 abort：静默。
        if (pending?.gen !== swapGen) return; // 已被更新的切换覆盖。
        pending = null; // 释放挂起的换源，避免后续点击困在防重循环里。
        if (cuePlaybackId !== null) reportOnce(cuePlaybackId, 'failed', REASON_ASSET_LOAD);
        console.warn(
          '[dsh-pet] 素材加载失败 pet=' +
            cfg.id +
            ' anim=' +
            next +
            '：' +
            (error instanceof Error ? error.message : String(error)) +
            '（已释放本次切换）',
        );
      },
    });
    const onReady = (): void => {
      el.removeEventListener('loadeddata', onReady);
      if (pending?.gen !== swapGen) return;
      const outgoing = elementOf(front);
      // 预载：上一段是提前收尾的，它还在播最后零点几秒。新段已解码好、停在首帧，等旧段真正播完
      // 再开播，旧段一帧都不截。期间 pending 保持不变：被打断时新的 switchTo 覆盖 gen，start 自然作废。
      const waitFor = preroll;
      preroll = null;
      if (waitFor !== null && waitFor === outgoing && !outgoing.ended && !outgoing.paused) {
        let started = false;
        const go = (): void => {
          if (started) return;
          started = true;
          outgoing.removeEventListener('ended', go);
          clearTimeout(safety);
          start();
        };
        outgoing.addEventListener('ended', go);
        // 兜底：ended 万一不来（解码提前停住），按剩余时长 + 余量强制开播
        const remain = Number.isFinite(outgoing.duration) ? Math.max(0, outgoing.duration - outgoing.currentTime) : 0;
        const safety = setTimeout(go, remain * 1000 + 300);
        return;
      }
      start();
    };
    const start = (): void => {
      if (pending?.gen !== swapGen) return;
      const outgoing = elementOf(front);
      if (outgoing !== null && outgoing !== el) {
        // 降级为背景的视频若继续播完，残留的 onended 会掐断当前前台动画：清 handler（停播在 presentSwap）。
        outgoing.onended = null;
        outgoing.onerror = null;
        // 被换下的点播若没播完，如实回 cancelled（补的是点击、拖拽这类非点播打断）。
        if (playing !== null && playing !== cuePlaybackId) reportOnce(playing, 'cancelled', REASON_SUPERSEDED);
      }
      front = front === 0 ? 1 : 0;
      pending = null;
      playing = cuePlaybackId;
      el.style.transform = deps.facing() === 'right' ? 'scaleX(-1)' : '';
      // 硬切：旧段保持可见，新段首帧真正出画后互换，旧段再垫几帧才撤（presentSwap）
      presentSwap(el, outgoing, () => elementOf(front) === el);
      if (nextOnce) armPreroll(el);
      el.play()
        .then(() => {
          // 只有 play() 兑现才代表确实开始出画，loadeddata 只代表可解码。
          if (cuePlaybackId !== null) deps.report(cuePlaybackId, 'playing');
        })
        .catch(() => {
          if (cuePlaybackId !== null) reportOnce(cuePlaybackId, 'failed', REASON_PLAY_REJECTED);
        });
      deps.onFrontReady(el);
    };
    el.addEventListener('loadeddata', onReady);
  };

  const handleEnded = (event?: Event): EndedCue => {
    // 只认前台元素的 ended：后台即便有残留事件也丢弃，防止掐断当前动画。
    const endedOn = event === undefined ? null : (event.currentTarget as HTMLVideoElement | null);
    if (endedOn !== null && !endedOn.classList.contains('is-front')) return { kind: 'ignore' };
    // 回执放在拖拽守卫之前：「播完」是既成事实，不该受动画链推进逻辑影响。
    const done = playing;
    if (done !== null) {
      playing = null; // 先清再上报，后续换源不会把它当成被打断。
      deps.report(done, 'ended');
    }
    if (deps.isDragging()) return { kind: 'ignore' };
    // 冻结时不推进：下面每条分支都会按当前工作状态换源，effect 的门禁拦不住。
    if (frozen) return { kind: 'ignore' };
    // 循环状态：推进到下一段（状态机自己换源，组件什么都不用做）；退出段播完回随机链
    if (loopRun !== null) {
      if (currentClip === loopRun.clip) {
        const nextRun = advanceLoopState(loopRun);
        if (nextRun !== null) {
          loopRun = nextRun;
          playLoopClip(nextRun.clip, null);
          return { kind: 'ignore' };
        }
        loopRun = null;
        // 退出段播完：有挂起的请求（保持期间来的）就播它，组件那边的 anim 早已是它；否则回随机链
        const after = afterLoopExit;
        afterLoopExit = null;
        if (after !== null) {
          cueUrl = after.url;
          switchTo(after.next, after.nextOnce, after.cuePlaybackId);
          return { kind: 'ignore' };
        }
        return { kind: 'random' };
      }
      loopRun = null; // ended 不是状态当前那一段的：期间被顶掉过，状态作废
    }
    const cue = decideEndedCue({
      animations: deps.cfg().animations,
      current: deps.currentAnim(),
      workState: deps.workStatus()?.state,
    });
    const petId = deps.cfg().id;
    if (cue.kind === 'work-rotate') {
      console.log('[dsh-pet] ' + stamp(petId) + ' workStatus 档内轮换: ' + deps.currentAnim() + ' -> ' + cue.anim);
    } else if (cue.kind === 'work-replay') {
      console.log('[dsh-pet] ' + stamp(petId) + ' workStatus 循环续播: ' + deps.currentAnim());
    } else if (cue.kind === 'event-done') {
      console.log('[dsh-pet] ' + stamp(petId) + ' 事件动画播完 ended anim=' + deps.currentAnim());
    }
    return cue;
  };

  /**
   * 预载下一段：一次性段播到只剩 PREROLL_SEC 秒时，提前把「播完」判定交给组件，让它选出下一段开始加载。
   * switchTo 的 onReady 会等这一段真正播完再开播新段（见 preroll），所以不截这一段的尾巴。
   * 被打断（换了别的段 / 冻结暂停 / onended 被换掉）时帧回调自然停掉。
   */
  /** 放开保持中的状态：改播退出段（站起来），退出段播完由 handleEnded 接着走。 */
  function releaseHeld(): void {
    if (loopRun === null || !loopRun.hold) return;
    loopRun = releaseLoopState(loopRun);
    playLoopClip(loopRun.clip, null);
  }

  /** 状态机自己换段：标记为内部换源，不算打断。每段都 once=true，靠 ended 推进。 */
  function playLoopClip(clip: string, cuePlaybackId: string | null): void {
    loopInternal = true;
    try {
      switchTo(clip, true, cuePlaybackId);
    } finally {
      loopInternal = false;
    }
  }

  const armPreroll = (el: HTMLVideoElement): void => {
    const fv = el as FrameVideo;
    if (typeof fv.requestVideoFrameCallback !== 'function') return;
    const cb = el.onended;
    if (cb === null) return;
    const tick = (_now: number, meta: { mediaTime: number }): void => {
      if (!mounted || el.onended !== cb || el.loop) return;
      const d = el.duration;
      if (Number.isFinite(d) && d - meta.mediaTime <= PREROLL_SEC) {
        el.onended = null; // 只触发一次：真正的 ended 不再重复收尾
        preroll = el;
        const cue = handleEnded();
        // 不推进（拖拽中 / 冻结）：撤掉标记，免得之后的点击还要等这一段播完。
        // 循环状态推进也回 ignore，但它已同步发起换源（pending 非空），标记要留给那次换源。
        if (cue.kind === 'ignore' && pending === null) preroll = null;
        deps.onEnded(cue);
        return;
      }
      fv.requestVideoFrameCallback?.(tick);
    };
    fv.requestVideoFrameCallback(tick);
  };

  return {
    switchTo,
    handleEnded,
    stopLoopingFront: () => {
      // 保持中的状态（等确认时坐着）：回空闲 = 站起来，站完回随机链
      if (loopRun?.hold === true) {
        releaseHeld();
        return;
      }
      const el = frontVideo();
      if (el === null) return;
      el.loop = false;
      el.onended = (event: Event) => deps.onEnded(handleEnded(event));
    },
    setCueUrl: (url) => {
      cueUrl = url;
    },
    setFrozen: (next) => {
      if (frozen === next) return null;
      frozen = next;
      if (next) {
        frontVideo()?.pause();
        // 冻结打断了正在播的点播：解冻不会接回来，所以是 cancelled 而不是暂停。
        if (playing !== null) reportOnce(playing, 'cancelled', REASON_FROZEN);
        return { kind: 'frozen' };
      }
      return { kind: 'resumed' };
    },
    isFrozen: () => frozen,
    frontVideo,
    playingPlayback: () => playing,
    dispose: () => {
      mounted = false;
      loader.abortAll();
      if (blobUrl.a !== null) loader.release(blobUrl.a);
      if (blobUrl.b !== null) loader.release(blobUrl.b);
      blobUrl.a = null;
      blobUrl.b = null;
    },
  };
}
