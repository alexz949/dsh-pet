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
