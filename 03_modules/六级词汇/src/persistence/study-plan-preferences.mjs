import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { deepFreeze } from '../domain/shared.mjs';
import { createCollectionStudyPlan } from '../study/study-plan.mjs';

export const STUDY_PLAN_PREFERENCES_VERSION = '0.1';

export function createLocalStudyPlanPreferences({ filePath }) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('absolute filePath required');

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed.version !== STUDY_PLAN_PREFERENCES_VERSION || !Array.isArray(parsed.plans)) throw new TypeError('invalid study plan preferences');
      return Object.freeze(parsed.plans.map((plan) => createCollectionStudyPlan(plan)));
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze([]);
      throw error;
    }
  }

  async function save(plans) {
    if (!Array.isArray(plans)) throw new TypeError('plans array required');
    const canonical = plans.map((plan) => createCollectionStudyPlan(plan));
    if (new Set(canonical.map((plan) => plan.collectionId)).size !== canonical.length) throw new TypeError('duplicate collection plan');
    const payload = `${JSON.stringify({ version: STUDY_PLAN_PREFERENCES_VERSION, plans: canonical }, null, 2)}\n`;
    await mkdir(dirname(filePath), { recursive: true });
    const temp = join(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
    let handle;
    try {
      handle = await open(temp, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temp, filePath);
    } finally {
      if (handle) await handle.close();
      try { await unlink(temp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    return deepFreeze({ version: STUDY_PLAN_PREFERENCES_VERSION, filePath, planCount: canonical.length });
  }

  return Object.freeze({ version: STUDY_PLAN_PREFERENCES_VERSION, filePath, load, save });
}
