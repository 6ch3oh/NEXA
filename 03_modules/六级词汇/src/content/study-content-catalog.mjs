import { normalizeIdentifier } from '../domain/shared.mjs';

export const STUDY_CONTENT_CATALOG_VERSION = '0.1';

export function createInMemoryStudyContentCatalog(initialContents = []) {
  const byId = new Map();
  function add(content) {
    if (!content || typeof content !== 'object') throw new TypeError('content object required');
    const contentId = normalizeIdentifier(content.contentId, 'contentId');
    if (byId.has(contentId)) throw new TypeError(`duplicate contentId: ${contentId}`);
    byId.set(contentId, content);
    return content;
  }
  function addMany(contents) {
    if (!Array.isArray(contents)) throw new TypeError('contents array required');
    const pending = contents.map((content) => {
      if (!content || typeof content !== 'object') throw new TypeError('content object required');
      return { contentId: normalizeIdentifier(content.contentId, 'contentId'), content };
    });
    const ids = pending.map((item) => item.contentId);
    if (new Set(ids).size !== ids.length) throw new TypeError('duplicate contentId in batch');
    for (const item of pending) {
      if (byId.has(item.contentId)) throw new TypeError(`duplicate contentId: ${item.contentId}`);
    }
    pending.forEach((item) => byId.set(item.contentId, item.content));
    return Object.freeze(pending.map((item) => item.content));
  }
  addMany(initialContents);
  return Object.freeze({
    catalogVersion: STUDY_CONTENT_CATALOG_VERSION,
    add,
    addMany,
    get(contentId) {
      return byId.get(normalizeIdentifier(contentId, 'contentId')) ?? null;
    },
    list() {
      return Object.freeze([...byId.values()]);
    },
    count() {
      return byId.size;
    },
  });
}
