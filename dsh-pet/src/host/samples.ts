/**
 * 首次运行放入示例干员：包内 samples/ 的宠物包（<id>-config.json + <id>-animation/）复制到用户宠物目录。
 *
 * 只在「从没放过、而且用户还一只宠物包都没有」时做一次，之后写标记文件，不管用户删不删都不再放——
 * 老用户（已经有自己的宠物包）直接写标记跳过，绝不往里塞东西。
 * 哪只显示、哪只隐藏由示例配置自己的 display 决定（阿米娅显示，其余隐藏，托盘里勾选即可叫出来）。
 * 失败只记日志，不影响启动。
 * @module dsh-pet/src/host/samples
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 标记文件名（放在用户数据根 $DSH_HOME/dsh-pet/ 下）。 */
export const SAMPLES_MARKER = '.samples-seeded';

const PACK_CONFIG_RE = /^(.+)-config\.jsonc?$/;

/**
 * @param o.samplesDir - 包内示例目录。
 * @param o.petDir - 用户宠物包目录。
 * @param o.userRoot - 用户数据根（放标记文件）。
 * @param o.log - 日志出口。
 * @returns 放进去的宠物包名；没放返回空数组。
 */
export function seedSamplePets(o: {
  samplesDir: string;
  petDir: string;
  userRoot: string;
  log?: (msg: string) => void;
}): string[] {
  const marker = join(o.userRoot, SAMPLES_MARKER);
  if (existsSync(marker)) return [];
  try {
    const hasOwn = existsSync(o.petDir) && readdirSync(o.petDir).some((f) => PACK_CONFIG_RE.test(f));
    const seeded: string[] = [];
    if (!hasOwn && existsSync(o.samplesDir)) {
      mkdirSync(o.petDir, { recursive: true });
      for (const f of readdirSync(o.samplesDir)) {
        const m = PACK_CONFIG_RE.exec(f);
        if (!m) continue;
        const pack = m[1];
        const anim = join(o.samplesDir, pack + '-animation');
        if (!existsSync(anim)) continue;
        cpSync(anim, join(o.petDir, pack + '-animation'), { recursive: true });
        cpSync(join(o.samplesDir, f), join(o.petDir, f));
        seeded.push(pack);
      }
      if (seeded.length) o.log?.('首次运行：放入示例干员 ' + seeded.join('、') + '（隐藏的在托盘里勾选即可显示）');
    }
    mkdirSync(o.userRoot, { recursive: true });
    writeFileSync(marker, new Date().toISOString() + '\n');
    return seeded;
  } catch (e) {
    o.log?.('放入示例干员失败（不影响使用）：' + (e instanceof Error ? e.message : String(e)));
    return [];
  }
}
