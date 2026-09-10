// Confirmed category-only mutation boundary for the Consumption public API.
// The repository remains the single writer and the sealed domain normalizer remains authoritative.
export function createExpenseReclassificationService(repository) {
  if (!repository || typeof repository.getById !== 'function' || typeof repository.upsert !== 'function') {
    throw new TypeError('expense reclassification requires an Expense Repository');
  }

  return Object.freeze({
    reclassify(recordId, category) {
      if (typeof recordId !== 'string' || recordId.trim() === '') {
        throw Object.assign(new TypeError('recordId must be a non-empty string'), { code: 'INVALID_RECORD_ID' });
      }
      if (typeof category !== 'string' || category.trim() === '') {
        throw Object.assign(new TypeError('category must be a non-empty string'), { code: 'INVALID_CATEGORY' });
      }
      const current = repository.getById(recordId.trim());
      if (current?.ok !== true || !current.record) {
        throw Object.assign(new Error('expense record was not found'), { code: 'EXPENSE_RECORD_NOT_FOUND' });
      }
      const priorCategory = current.record.category;
      const result = repository.upsert({ ...current.record, category: category.trim() });
      if (result?.ok !== true) {
        throw Object.assign(new Error('expense category update failed'), { code: result?.error?.code || 'RECLASSIFY_FAILED' });
      }
      return Object.freeze({
        changed: priorCategory !== result.record.category,
        recordId: result.record.id,
        previousCategory: priorCategory,
        category: result.record.category,
        record: result.record,
      });
    },
  });
}
