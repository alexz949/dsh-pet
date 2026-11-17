/**
 * 循环状态的纯函数：选段、掷遍数、推进与配置校验。
 * @module dsh-pet/src/shared/loop-states.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceLoopState,
  findLoopState,
  loopStatesValid,
  rollLoopCount,
  startLoopState,
  type LoopState,
} from './loop-states.ts';

const sit: LoopState = { name: '坐着', enter: ['坐下'], loop: ['坐-循环'], exit: ['起来'], minLoops: 2, maxLoops: 4 };

test('findLoopState：按名字找，没有或未配置返回 null', () => {
  assert.equal(findLoopState([sit], '坐着'), sit);
  assert.equal(findLoopState([sit], '待机'), null);
  assert.equal(findLoopState(undefined, '坐着'), null);
});

test('rollLoopCount：闭区间 [min, max] 内的整数，两端都取得到', () => {
  assert.equal(rollLoopCount(sit, 0), 2);
  assert.equal(rollLoopCount(sit, 0.999), 4);
  assert.equal(rollLoopCount(sit, 0.5), 3);
  assert.equal(rollLoopCount({ ...sit, minLoops: 3, maxLoops: 3 }, 0.7), 3);
});

test('推进：进入 → 循环 N 遍 → 退出 → 结束', () => {
  let run = startLoopState(sit);
  assert.deepEqual([run.phase, run.clip], ['enter', '坐下']);
  const seen: string[] = [run.phase];
  // roll=0 → 循环 2 遍
  let next = advanceLoopState(run, 0);
  while (next) {
    seen.push(next.phase);
    run = next;
    next = advanceLoopState(run, 0);
  }
  assert.deepEqual(seen, ['enter', 'loop', 'loop', 'exit']);
  assert.equal(run.clip, '起来');
});

test('minLoops = 0 且掷到 0：进入后直接退出', () => {
  const quick = { ...sit, minLoops: 0, maxLoops: 0 };
  const after = advanceLoopState(startLoopState(quick), 0);
  assert.equal(after?.phase, 'exit');
});

test('循环段多候选时避开刚播完的那个', () => {
  const multi = { ...sit, loop: ['a', 'b'], minLoops: 3, maxLoops: 3 };
  let run = advanceLoopState(startLoopState(multi), 0)!;
  for (let i = 0; i < 2; i++) {
    const next = advanceLoopState(run, 0)!;
    assert.notEqual(next.clip, run.clip);
    run = next;
  }
});

test('loopStatesValid：合法通过，形状不对一律拒绝', () => {
  assert.equal(loopStatesValid([sit]), true);
  assert.equal(loopStatesValid([]), true);
  assert.equal(loopStatesValid({}), false);
  assert.equal(loopStatesValid([{ ...sit, enter: [] }]), false);
  assert.equal(loopStatesValid([{ ...sit, loop: [''] }]), false);
  assert.equal(loopStatesValid([{ ...sit, name: '' }]), false);
  assert.equal(loopStatesValid([sit, sit]), false); // 重名
  assert.equal(loopStatesValid([{ ...sit, minLoops: -1 }]), false);
  assert.equal(loopStatesValid([{ ...sit, minLoops: 1.5 }]), false);
  assert.equal(loopStatesValid([{ ...sit, maxLoops: 1 }]), false); // max < min
});

test('保持模式：进入后一直循环，不计遍数；放开后转到退出段', async () => {
  const { releaseLoopState } = await import('./loop-states.ts');
  let run = startLoopState(sit, true);
  for (let i = 0; i < 20; i++) {
    const next = advanceLoopState(run, 0);
    assert.ok(next && next.phase === 'loop', '保持中不该自己退出');
    run = next;
  }
  const out = releaseLoopState(run);
  assert.deepEqual([out.phase, out.clip, out.hold], ['exit', '起来', false]);
  assert.equal(advanceLoopState(out), null, '退出段播完即结束');
});
