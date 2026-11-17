/**
 * 没人理就自己睡：判定与校验。
 * @module dsh-pet/src/shared/auto-sleep.test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidAutoSleepMinutes, isWorkBusy, shouldAutoSleep } from './auto-sleep.ts';

const base = {
  minutes: 10,
  lastActiveAt: 0,
  now: 10 * 60_000,
  sleeping: false,
  frozen: false,
  dragging: false,
  hasSleep: true,
};

test('到点且条件都满足：该睡', () => {
  assert.equal(shouldAutoSleep(base), true);
  assert.equal(shouldAutoSleep({ ...base, now: 10 * 60_000 - 1 }), false, '差 1ms 不到点');
});

test('关闭 / 没睡觉动作 / 已在睡 / 冻结 / 拖拽中：都不睡', () => {
  for (const minutes of [undefined, 0, -5, Number.NaN]) assert.equal(shouldAutoSleep({ ...base, minutes }), false);
  assert.equal(shouldAutoSleep({ ...base, hasSleep: false }), false);
  assert.equal(shouldAutoSleep({ ...base, sleeping: true }), false);
  assert.equal(shouldAutoSleep({ ...base, frozen: true }), false);
  assert.equal(shouldAutoSleep({ ...base, dragging: true }), false);
});

test('isWorkBusy：非终态算忙，空闲与终态不算', () => {
  for (const s of ['thinking', 'working', 'waiting']) assert.equal(isWorkBusy(s), true);
  for (const s of [null, undefined, 'success', 'error']) assert.equal(isWorkBusy(s), false);
});

test('isValidAutoSleepMinutes：≥0 的有限数字', () => {
  for (const v of [0, 1, 7.5]) assert.equal(isValidAutoSleepMinutes(v), true);
  for (const v of [-1, Number.NaN, Infinity, '10', null]) assert.equal(isValidAutoSleepMinutes(v), false);
});
