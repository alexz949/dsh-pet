import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nextCopyId, addCopy, removeInstance } = require('../../runtime/electron-helper/main/manage.js');
const { parseSources, planClips, buildPackConfig } = require('../../runtime/electron-helper/importer/plan.js');

const pack = {
  pets: [
    {
      id: 'ulpianus',
      name: '乌尔比安',
      display: 'desktop',
      position: { corner: 'top-right', marginX: 24, marginY: 700 },
    },
  ],
  animations: { idle: ['待机'] },
};

test('copy ids skip taken ones and do not stack suffixes', () => {
  assert.equal(nextCopyId('ulpianus', new Set(['ulpianus'])), 'ulpianus-2');
  assert.equal(nextCopyId('ulpianus', new Set(['ulpianus', 'ulpianus-2'])), 'ulpianus-3');
  assert.equal(nextCopyId('ulpianus-2', new Set(['ulpianus', 'ulpianus-2'])), 'ulpianus-3');
  // 导入干员的哈希 id 末尾可能全是数字：不能当成分身编号剥掉
  assert.equal(nextCopyId('op-12345678', new Set()), 'op-12345678-2');
});

test('addCopy appends a desktop instance shifted one slot per existing instance', () => {
  const out = addCopy(pack, 'ulpianus', 'ulpianus-2');
  assert.deepEqual(
    out.pets.map((p: { id: string }) => p.id),
    ['ulpianus', 'ulpianus-2'],
  );
  assert.equal(out.pets[1].position.marginX, 164);
  assert.equal(out.pets[1].display, 'desktop');
  assert.equal(pack.pets.length, 1, 'does not mutate the input');
  assert.equal(addCopy(out, 'ulpianus', 'ulpianus-3').pets[2].position.marginX, 304);
  assert.equal(addCopy(pack, 'nope', 'x'), null);
});

test('removeInstance reports whether the last instance went away', () => {
  const two = addCopy(pack, 'ulpianus', 'ulpianus-2');
  assert.deepEqual(removeInstance(two, 'ulpianus-2'), { config: pack, last: false });
  assert.equal(removeInstance(pack, 'ulpianus').last, true);
  assert.equal(removeInstance(pack, 'nope'), null);
});

test('importer recognizes PRTS file names and numbered specials', () => {
  const files = [
    '/d/乌尔比安-注目深渊-基建-Relax-x1.webm',
    '/d/乌尔比安-注目深渊-基建-Move-x1.webm',
    '/d/乌尔比安-注目深渊-基建-Special-x1.webm',
    '/d/乌尔比安-注目深渊-基建-Special2-x1.webm',
    '/d/空弦-默认-基建-Sit-x1@2x.gif',
  ];
  const r = parseSources(files);
  assert.equal(r.ok, true);
  assert.equal(r.name, '乌尔比安·注目深渊');
  assert.match(r.id, /^op-[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(r.roles).sort(), ['Move', 'Relax']);
  assert.deepEqual(
    r.extras.map((x: { anim: string }) => x.anim),
    ['特别动作', '特别动作2'],
  );
  assert.deepEqual(r.ignored, ['空弦-默认-基建-Sit-x1@2x.gif']);
  assert.equal(parseSources(['/d/Move.webm']).ok, false, 'Relax is required');
});

test('importer config only references animations it built', () => {
  const parsed = parseSources(['/d/Relax.webm', '/d/Move.webm'], 'demo');
  const clips = planClips(parsed, { Relax: 120, Move: 100 });
  const built = new Set<string>(clips.flatMap((c: { names: string[] }) => c.names));
  const cfg = buildPackConfig({
    id: parsed.id,
    name: parsed.name,
    built,
    walks: [{ name: '走路', sec: 6.67 }],
    walkSpeed: 1.6,
    extras: [],
  });
  assert.equal(cfg.animations.sleep, undefined);
  assert.equal(cfg.animations.states, undefined);
  assert.deepEqual(cfg.animations.clicks, []);
  const evs = Object.values(cfg.animations.events).flat();
  for (const name of evs) assert.ok(built.has(name as string), String(name) + ' must exist');
});

const skills = require('../../runtime/electron-helper/importer/skills.js');

test('skill files: Begin/Loop/Idle/End become a loop state, Start becomes the entrance', () => {
  const dir = '/d/维什戴尔-绝对主角-正面-';
  const names = ['Attack_B', 'Skill_1', 'Skill_3_Begin', 'Skill_3_Loop', 'Skill_3_Idle', 'Skill_3_End', 'Start'];
  const r = skills.parseSkillFiles(
    names.map((n) => dir + n + '-x1.webm'),
    new Set(['待机']),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.singles.map((s: { name: string }) => s.name),
    ['攻击B', '技能1'],
  );
  assert.equal(r.start.name, '出场');
  assert.equal(r.states.length, 1);
  assert.deepEqual(
    [r.states[0].name, r.states[0].enter, r.states[0].loop, r.states[0].exit],
    ['技能3', '技能3-起手', ['技能3-攻击', '技能3-架势'], '技能3-收招'],
  );
  assert.equal(skills.displayName('Skill_2_Overload'), '技能2·过载');
});

test('merging skills wires the working slot and keeps the full skill near 20s', () => {
  const r = skills.parseSkillFiles([
    '/d/x-正面-Attack-x1.webm',
    '/d/x-正面-Skill_3_Begin-x1.webm',
    '/d/x-正面-Skill_3_Loop-x1.webm',
    '/d/x-正面-Skill_3_End-x1.webm',
  ]);
  const { clips } = skills.skillSourcesAndClips(r);
  const built = new Set<string>(clips.flatMap((c: { names: string[] }) => c.names));
  const cfg = skills.mergeSkillConfig(
    { pets: [{ id: 'x', workStatusEnabled: false }], animations: { idle: ['待机'], categories: [], events: {} } },
    r,
    built,
    { '技能3-起手': 1, '技能3-攻击': 5, '技能3-收招': 1 },
  );
  for (const i of [0, 1, 2]) assert.deepEqual(cfg.animations.events.workStatus[i], ['攻击·事件', '技能3']);
  assert.equal(cfg.animations.events.workStatus.length, 6);
  assert.equal(cfg.pets[0].workStatusEnabled, true);
  const st = cfg.animations.states.find((s: { name: string }) => s.name === '技能3');
  assert.deepEqual([st.minLoops, st.maxLoops], [3, 5]);
  assert.ok(built.has('攻击·事件'), 'event copy for singles used in workStatus');
});
