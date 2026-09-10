import { PersonalVocabularyList } from '../viewmodels/personal-vocabulary-view-model.mjs';

export const STUDY_CENTER_UI_CONTROLLER_VERSION = '0.1';

export function createStudyCenterUiController({ runtime, now = () => new Date().toISOString(), onMutation = async () => {} }) {
  if (typeof runtime?.home !== 'function' || typeof runtime?.queue?.build !== 'function') throw new TypeError('CET6 study runtime required');
  if (typeof now !== 'function' || typeof onMutation !== 'function') throw new TypeError('now/onMutation functions required');
  let plan = runtime.createPlan();
  let currentQueue = null;
  let currentEntryId = null;
  let answerVisible = true;

  function loadHome() { return runtime.home({ now: now(), plan }); }
  function loadToday() {
    currentQueue = runtime.queue.build({ now: now(), plan });
    return currentQueue;
  }
  function openCard(entryId) {
    const queueItem = currentQueue?.items.find((item) => item.entryId === entryId) ?? null;
    const card = runtime.card.load(entryId, queueItem ? { queueReason: queueItem.queueReason } : {});
    if (!card) throw new TypeError(`word not found: ${entryId}`);
    currentEntryId = entryId;
    answerVisible = true;
    return Object.freeze({
      ...card,
      answerVisible,
      queuePosition: queueItem?.position ?? null,
      queueTotal: queueItem?.total ?? null,
    });
  }
  function currentCard() {
    if (currentEntryId === null) return null;
    const queueItem = currentQueue?.items.find((item) => item.entryId === currentEntryId) ?? null;
    return Object.freeze({
      ...runtime.card.load(currentEntryId, queueItem ? { queueReason: queueItem.queueReason } : {}),
      answerVisible,
      queuePosition: queueItem?.position ?? null,
      queueTotal: queueItem?.total ?? null,
    });
  }
  function revealAnswer() { if (currentEntryId === null) throw new TypeError('no current card'); answerVisible = true; return currentCard(); }

  async function mutate(action) {
    const result = action();
    await onMutation();
    return result;
  }
  async function rate(rating, options = {}) {
    if (currentEntryId === null) throw new TypeError('no current card');
    const result = await mutate(() => runtime.session.rate(currentEntryId, rating, { ...options, at: options.at ?? now() }));
    answerVisible = true;
    return result;
  }
  async function master(options = {}) {
    if (currentEntryId === null) throw new TypeError('no current card');
    return mutate(() => runtime.session.master(currentEntryId, { ...options, at: options.at ?? now() }));
  }
  async function setFavorite(favorite, options = {}) {
    if (currentEntryId === null) throw new TypeError('no current card');
    return mutate(() => runtime.session.setFavorite(currentEntryId, favorite, { ...options, at: options.at ?? now() }));
  }
  async function setUnknown(unknown, options = {}) {
    if (currentEntryId === null) throw new TypeError('no current card');
    return mutate(() => runtime.session.setUnknown(currentEntryId, unknown, { ...options, at: options.at ?? now() }));
  }
  async function updatePlan(limits) {
    plan = runtime.createPlan(limits);
    await onMutation({ type: 'plan', plan });
    return plan;
  }
  function personal(kind = PersonalVocabularyList.ALL) { return runtime.personalVocabulary.list(kind); }

  return Object.freeze({
    controllerVersion: STUDY_CENTER_UI_CONTROLLER_VERSION,
    loadHome, loadToday, openCard, currentCard, revealAnswer, rate, master,
    setFavorite, setUnknown, updatePlan, personal,
    getPlan: () => plan,
  });
}
