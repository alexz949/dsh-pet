import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLES_MARKER, seedSamplePets } from './samples.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-samples-'));
  const samplesDir = join(root, 'samples');
  mkdirSync(join(samplesDir, 'amiya-animation'), { recursive: true });
  writeFileSync(join(samplesDir, 'amiya-config.json'), '{"pets":[]}');
  writeFileSync(join(samplesDir, 'amiya-animation', '待机.webm'), 'x');
  writeFileSync(join(samplesDir, 'README.md'), 'notice');
  const userRoot = join(root, 'home', 'dsh-pet');
  return { samplesDir, userRoot, petDir: join(userRoot, 'pet') };
}

test('fresh install gets the samples once', () => {
  const f = fixture();
  assert.deepEqual(seedSamplePets(f), ['amiya']);
  assert.ok(existsSync(join(f.petDir, 'amiya-animation', '待机.webm')));
  assert.ok(existsSync(join(f.userRoot, SAMPLES_MARKER)));
  assert.ok(!readdirSync(f.petDir).includes('README.md'), 'only pet packs are copied');
  assert.deepEqual(seedSamplePets(f), [], 'never seeds twice, even after the user deletes them');
});

test('existing users with their own packs are left alone', () => {
  const f = fixture();
  mkdirSync(f.petDir, { recursive: true });
  writeFileSync(join(f.petDir, 'mine-config.json'), '{}');
  assert.deepEqual(seedSamplePets(f), []);
  assert.deepEqual(readdirSync(f.petDir), ['mine-config.json']);
  assert.ok(existsSync(join(f.userRoot, SAMPLES_MARKER)));
});
