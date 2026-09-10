import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidRecommendationDecision, RecommendationDecisionError } from './recommendation-engine.mjs';

function boundedPath(rootDir, filePath) {
  const root = resolve(rootDir); const target = resolve(filePath); const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new DecisionStoreError('DECISION_STORE_PATH_ESCAPE', 'Decision Store path must be a file below rootDir.');
  return target;
}

function semanticValue(decision) { const value = structuredClone(decision); delete value.generated_at; return JSON.stringify(value); }

export class DecisionStoreError extends Error {
  constructor(code, message, cause = null) { super(message, cause ? { cause } : undefined); this.name = 'DecisionStoreError'; this.code = code; }
}

export class DecisionStore {
  constructor({ filePath, rootDir = process.cwd() }) { this.rootDir = resolve(rootDir); this.filePath = boundedPath(this.rootDir, filePath); }

  async readAll() {
    let content;
    try { content = await readFile(this.filePath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw new DecisionStoreError('DECISION_STORE_READ_FAILED', 'Decision Store read failed safely.', error); }
    return content.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try { const decision = JSON.parse(line); assertNoSensitiveData(decision, 'Persisted Recommendation Decision'); assertValidRecommendationDecision(decision); return decision; }
      catch (error) { throw new DecisionStoreError('DECISION_STORE_RECORD_INVALID', `Decision Store line ${index + 1} is invalid.`, error); }
    });
  }

  async write(decision) {
    try { assertNoSensitiveData(decision, 'Recommendation Decision'); assertValidRecommendationDecision(decision); }
    catch (error) { if (error instanceof RecommendationDecisionError) throw new DecisionStoreError('RECOMMENDATION_DECISION_INVALID', 'Recommendation Decision validation failed.', error); throw error; }
    const existing = (await this.readAll()).find((item) => item.decision_id === decision.decision_id);
    if (existing) { if (semanticValue(existing) !== semanticValue(decision)) throw new DecisionStoreError('DECISION_ID_COLLISION', 'decision_id already exists with different semantic content.'); return { status: 'duplicate_skipped', decision_id: decision.decision_id }; }
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(decision)}\n`, { encoding: 'utf8' });
    return { status: 'written', decision_id: decision.decision_id };
  }

  async queryByDecisionId(value) { return (await this.readAll()).filter((item) => item.decision_id === value); }
  async queryByRequestId(value) { return (await this.readAll()).filter((item) => item.request_id === value); }
  async queryByScenarioId(value) { return (await this.readAll()).filter((item) => item.scenario_id === value); }
  async queryByStatus(value) { return (await this.readAll()).filter((item) => item.status === value); }
  async queryBySourceClass(value) { return (await this.readAll()).filter((item) => item.source_class === value); }
  async queryByRecommendedCandidate({ candidateId = null, provider = null, model = null } = {}) { return (await this.readAll()).filter((item) => item.recommended_candidate && (candidateId === null || item.recommended_candidate.candidate_id === candidateId) && (provider === null || item.recommended_candidate.provider === provider) && (model === null || item.recommended_candidate.model === model)); }
  async queryOfficialDecisions() { return (await this.readAll()).filter((item) => item.source_class === 'REAL_RECOMMENDATION'); }
}
