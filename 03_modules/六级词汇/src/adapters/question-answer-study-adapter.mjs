import { deepFreeze } from '../domain/shared.mjs';
import { createReviewCard, ReviewCardType } from '../study/review-card.mjs';
import { createStudyItem, StudyContentType } from '../study/study-item.mjs';

export const QUESTION_ANSWER_STUDY_ADAPTER_VERSION = '0.1';

export function createQuestionAnswerStudyAdapter({ collectionId, authorityType = 'study-content' }) {
  function adapt(content) {
    if (!['question_answer', 'multiple_choice'].includes(content.contentType)) throw new TypeError('QA or multiple-choice content required');
    const authorityRef = Object.freeze({ authorityType, entityId: content.contentId });
    // Collection identity is part of every generic item/card identity. Content ids
    // only need to be unique inside their authoritative collection.
    const itemId = `study-${collectionId}-${content.contentId}`;
    const studyItem = createStudyItem({
      itemId,
      collectionId,
      contentType: content.contentType === 'multiple_choice' ? StudyContentType.MULTIPLE_CHOICE : StudyContentType.QUESTION_ANSWER,
      source: content.sourceRef,
      tags: content.tags,
      authorityRef,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    });
    const reviewCard = createReviewCard({
      cardId: `card-${collectionId}-${content.contentId}-default`,
      itemId,
      cardType: content.contentType === 'multiple_choice' ? ReviewCardType.MULTIPLE_CHOICE : ReviewCardType.RECALL,
      promptRef: { authorityRef, selector: 'question' },
      answerRef: { authorityRef, selector: 'answer' },
      enabled: true,
      createdAt: content.createdAt,
    });
    return deepFreeze({
      adapterVersion: QUESTION_ANSWER_STUDY_ADAPTER_VERSION,
      studyItem,
      reviewCards: [reviewCard],
      presentation: {
        question: content.question,
        answer: content.answer,
        explanation: content.explanation,
        options: content.options ?? [],
        correctAnswer: content.correctAnswer ?? null,
        answerVisibleByDefault: false,
      },
    });
  }
  return Object.freeze({ adapterVersion: QUESTION_ANSWER_STUDY_ADAPTER_VERSION, collectionId, authorityType, adapt });
}
