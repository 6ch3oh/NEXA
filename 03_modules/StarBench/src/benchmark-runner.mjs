import { assertNoSensitiveData } from './credential-provider.mjs';
import { importRawResult } from './raw-result-importer.mjs';

export class BenchmarkRunnerError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BenchmarkRunnerError';
    this.code = code;
  }
}

export class OfflineBenchmarkRunner {
  constructor({ harness, store }) {
    if (!harness || typeof harness.run !== 'function') throw new BenchmarkRunnerError('HARNESS_REQUIRED', 'Existing Benchmark Harness is required.');
    if (!store || typeof store.write !== 'function') throw new BenchmarkRunnerError('STORE_REQUIRED', 'Existing Evaluation Store is required.');
    this.harness = harness;
    this.store = store;
  }

  async runSuite(resolvedSuite, { parameterOverrides = {} } = {}) {
    assertNoSensitiveData(resolvedSuite, 'Resolved Benchmark Suite');
    assertNoSensitiveData(parameterOverrides, 'Benchmark parameter overrides');
    if (!resolvedSuite || !Array.isArray(resolvedSuite.tasks) || !resolvedSuite.suite_identity) {
      throw new BenchmarkRunnerError('RESOLVED_SUITE_INVALID', 'Runner requires a resolved Benchmark Suite.');
    }
    const results = [];
    for (const entry of resolvedSuite.tasks) {
      const task = entry.task;
      const harnessTask = {
        benchmark_task: task.benchmark_task_id,
        task_identity: { task_id: task.benchmark_task_id, task_version: task.version },
        prompt_identity: structuredClone(task.prompt_identity),
        prompt: structuredClone(task.prompt),
        input_definition: structuredClone(task.input_definition),
        parameters: {
          ...structuredClone(resolvedSuite.definition.default_parameters),
          ...structuredClone(task.parameters),
          ...structuredClone(parameterOverrides),
        },
        metadata: {
          benchmark_definition: {
            category: task.category,
            task_type: task.task_type,
            source_class: task.source_class,
            evaluation_method: task.evaluation_method.type,
            metrics: structuredClone(task.metrics),
          },
          suite_identity: structuredClone(resolvedSuite.suite_identity),
          fixture: task.source_class === 'TEST_FIXTURE',
        },
      };
      const rawResult = await this.harness.run(harnessTask);
      const evaluation = importRawResult(rawResult);
      const storeResult = await this.store.write(evaluation);
      results.push({
        order: entry.order,
        benchmark_task_id: task.benchmark_task_id,
        task_identity: structuredClone(harnessTask.task_identity),
        prompt_identity: structuredClone(task.prompt_identity),
        raw_result: rawResult,
        evaluation,
        store_result: storeResult,
      });
    }
    return { suite_identity: structuredClone(resolvedSuite.suite_identity), results };
  }
}
