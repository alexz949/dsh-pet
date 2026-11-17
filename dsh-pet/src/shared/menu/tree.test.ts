/**
 * 菜单放行判定与第三方菜单层级的单元测试。
 *
 * 这两份判据被浏览器与桌面两端共用（桌面经 shared-core 拿到同一份），所以钉在这里，
 * 免得一端改了另一端跟着漂移。
 * 跑法：node --experimental-strip-types --test src/shared/menu/tree.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompactMenu,
  buildMenuTree,
  buildMoreBranch,
  isSleepAllowedAction,
  mergeMoveVariants,
  readMenuItems,
} from './tree.ts';
import type { Animations } from '../types.ts';
import type { MenuNode } from './types.ts';

describe('isSleepAllowedAction —— 睡着时仍然放行的动作', () => {
  test('睡觉 / 起来 / 维护类 / 第三方菜单项放行', () => {
    for (const action of ['sleep', 'wake', 'home', 'set-display', 'reload', 'third-party']) {
      assert.equal(isSleepAllowedAction(action), true, action + ' 应放行');
    }
  });

  test('打扰类一律不放行（对话 / 碎碎念 / 余额 / 待办 / 动作点播）', () => {
    for (const action of ['chat', 'whisper', 'show-balance', 'todo']) {
      assert.equal(isSleepAllowedAction(action), false, action + ' 应被拒');
    }
    // 点播动画的叶子只有 anim、没有 action
    assert.equal(isSleepAllowedAction(undefined), false);
  });
});

describe('buildMoreBranch —— 「更多」：label 唯一平铺，重名收进 owner 子菜单', () => {
  test('没有第三方项 → null（菜单里不出现空的「更多」）', () => {
    assert.equal(buildMoreBranch([]), null);
  });

  test('label 全局唯一 → 直接平铺在「更多」下，顺序 = 注册顺序', () => {
    const items = [
      { owner: '状态桥', label: '今日积分' },
      { owner: '小游戏', label: '弹弓' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '今日积分', action: 'third-party', owner: '状态桥' },
        { label: '弹弓', action: 'third-party', owner: '小游戏' },
      ],
    });
  });

  test('label 重名 → 每个 owner 在「更多」下各占一个子菜单，子项仍是原 label', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '插件B', label: '签到' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '插件A', children: [{ label: '签到', action: 'third-party', owner: '插件A' }] },
        { label: '插件B', children: [{ label: '签到', action: 'third-party', owner: '插件B' }] },
      ],
    });
  });

  test('同一 owner 的多个重名项收进同一个子菜单，组内保持注册顺序', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '插件B', label: '签到' },
      { owner: '插件A', label: '查积分' },
      { owner: '插件B', label: '查积分' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        {
          label: '插件A',
          children: [
            { label: '签到', action: 'third-party', owner: '插件A' },
            { label: '查积分', action: 'third-party', owner: '插件A' },
          ],
        },
        {
          label: '插件B',
          children: [
            { label: '签到', action: 'third-party', owner: '插件B' },
            { label: '查积分', action: 'third-party', owner: '插件B' },
          ],
        },
      ],
    });
  });

  test('唯一项与重名项混合：唯一项平铺，重名项才进 owner 子菜单', () => {
    const items = [
      { owner: '插件A', label: '签到' },
      { owner: '小游戏', label: '弹弓' },
      { owner: '插件B', label: '签到' },
    ];
    assert.deepEqual(buildMoreBranch(items), {
      label: '更多',
      children: [
        { label: '插件A', children: [{ label: '签到', action: 'third-party', owner: '插件A' }] },
        { label: '弹弓', action: 'third-party', owner: '小游戏' },
        { label: '插件B', children: [{ label: '签到', action: 'third-party', owner: '插件B' }] },
      ],
    });
  });

  test('重名判定用端过滤之后的结果：本端只有一条时不该被另一端拖进子菜单', () => {
    const data = {
      items: [
        { owner: '插件A', label: '签到', target: 'web' },
        { owner: '插件B', label: '签到', target: 'desktop' },
      ],
    };
    assert.deepEqual(buildMoreBranch(readMenuItems(data, 'desktop')), {
      label: '更多',
      children: [{ label: '签到', action: 'third-party', owner: '插件B' }],
    });
    assert.deepEqual(buildMoreBranch(readMenuItems(data, 'web')), {
      label: '更多',
      children: [{ label: '签到', action: 'third-party', owner: '插件A' }],
    });
  });
});

describe('buildCompactMenu —— 精简菜单', () => {
  const chat = { label: '对话', action: 'chat' } as MenuNode;
  const sleepItem = { label: '睡觉', action: 'sleep' } as MenuNode;
  const actions = [{ label: '动作', children: [] }] as MenuNode[];
  const balance = { label: '查看余额', action: 'show-balance' } as MenuNode;

  test('第一层 = 常用项 + 动作树；其余收进唯一的「更多」，第三方项接在末尾', () => {
    const third = buildMoreBranch([{ owner: 'x', label: '弹弓' }]);
    const tree = buildCompactMenu({ primary: [chat, sleepItem], actions, rare: [balance], thirdParty: third });
    assert.deepEqual(
      tree.map((n) => n.label),
      ['对话', '睡觉', '动作', '更多'],
    );
    const more = tree[3] as { children: MenuNode[] };
    assert.deepEqual(
      more.children.map((n) => n.label),
      ['查看余额', '弹弓'],
    );
    assert.equal(tree.filter((n) => n.label === '更多').length, 1, '不会出现两个「更多」');
  });

  test('没有可收的项也没有第三方项：不出现空的「更多」', () => {
    const tree = buildCompactMenu({ primary: [chat], actions, rare: [], thirdParty: null });
    assert.deepEqual(
      tree.map((n) => n.label),
      ['对话', '动作'],
    );
  });
});

describe('buildMenuTree —— 去重 / 平铺 / 走法合并', () => {
  const small = {
    idle: ['待机'],
    turn: ['转身'],
    drag: [],
    clicks: ['互动'],
    moves: { default: {}, actions: [{ name: '走路-短' }, { name: '走路' }, { name: '走路-长' }] },
    categories: [{ id: '小动作', weight: 30, actions: ['坐着', '特别动作', '互动'] }],
    events: { balance: ['互动', '坐下'], workStatus: ['待机', '坐着', '坐下'] },
  } as unknown as Animations;
  const labels = (nodes: MenuNode[]): string[] => nodes.map((n) => n.label);

  test('动作少：平铺、去重、不列事件专用动画、走法合并成一项', () => {
    const [root] = buildMenuTree(small) as Array<{ label: string; children: MenuNode[] }>;
    assert.equal(root.label, '动作');
    assert.deepEqual(labels(root.children), ['待机', '转身', '互动', '走路', '坐着', '特别动作']);
  });

  test('走法合并：点播时取几种长度之一', () => {
    const [walk] = mergeMoveVariants(['走路-短', '走路', '走路-长'], () => 0.99);
    assert.deepEqual(walk, { label: '走路', anim: '走路-长' });
    assert.deepEqual(
      mergeMoveVariants(['螃蟹走路', '原地漂浮踏步']).map((l) => l.label),
      ['螃蟹走路', '原地漂浮踏步'],
    );
  });

  test('动作多：保持分组，但同名只出现一次', () => {
    const many = Array.from({ length: 12 }, (_, i) => 'a' + i);
    const big = {
      ...small,
      categories: [{ id: '玩耍', weight: 30, actions: [...many, '互动'] }],
    } as unknown as Animations;
    const [root] = buildMenuTree(big) as Array<{
      label: string;
      children: Array<{ label: string; children: MenuNode[] }>;
    }>;
    const groupLabels = labels(root.children);
    assert.ok(groupLabels.includes('玩耍') && groupLabels.includes('点击回应'), '分组仍在');
    const all = root.children.flatMap((g) => labels(g.children));
    assert.equal(all.filter((n) => n === '互动').length, 1, '互动只出现一次');
    assert.ok(all.includes('坐下'), '分组模式下事件专用动画仍可预览');
  });
});
