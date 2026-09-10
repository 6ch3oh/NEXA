import {
  GenericStudySourceClassification,
  StudyCollectionType,
  calculateStudyContentDigest,
  createMultipleChoiceContent,
  createStudyCollection,
  createStudyContentPackageManifest,
} from '../src/index.mjs';

export const MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID = 'multiple-choice-validation-pack';
export const MULTIPLE_CHOICE_VALIDATION_PACK_NAME = 'Generic Multiple Choice Validation Pack';
export const MULTIPLE_CHOICE_VALIDATION_MARKER = 'TEST / SYNTHETIC / PRODUCT VALIDATION ONLY';
export const MULTIPLE_CHOICE_VALIDATION_TIMESTAMP = '2026-08-22T00:00:00.000Z';

const DEFINITIONS = [
  ['看到“TEST / SYNTHETIC”标记时，最准确的理解是？', ['正式考试题', '产品验证用合成内容'], 1, '该标记明确表示内容仅用于产品与架构验证。'],
  ['本地学习应用在没有网络时，哪项仍应可用？', ['本地已保存的学习队列', '在线搜索', '云端登录'], 0, '本题验证本地优先产品语义。'],
  ['数字序列 2、4、6 后面最自然的是？', ['7', '8', '9', '10'], 1, '该合成序列每次增加 2。'],
  ['Which value is equal to 3 × 3?', ['6', '8', '9'], 2, '3 × 3 equals 9.'],
  ['一个集合有 5 个项目，完成 2 个后还剩多少个？', ['2', '3', '5'], 1, '5 - 2 = 3。'],
  ['“回答正确”与“复习评分”在学习系统中应当如何处理？', ['完全等同', '保持职责分离', '只保存回答结果', '只保存评分'], 1, '答题结果是内容交互，评分是调度证据。'],
  ['以下哪一项是明确的复习评分？', ['AGAIN', '蓝色', '下一题'], 0, null],
  ['AGAIN 的第一步重学间隔是？', ['1 分钟', '1 小时', '1 天', '不再出现'], 0, '共享重学合同规定第一步为 1 分钟。'],
  ['同一个 learner 学习两个 Collection 时，进度应该？', ['互相覆盖', '按稳定身份隔离', '只保留最后一个'], 1, 'StudyItem identity 将进度绑定到具体 Collection。'],
  ['Which label means the content is not official?', ['official = true', 'official = false'], 1, null],
  ['选择更长但仍然清晰的一项：学习计划的每日总量上限应当由哪个范围负责？', ['由每个 Collection 的独立 StudyPlan 负责，修改一个 Collection 不应连带修改另一个 Collection', '所有 Collection 共用一个写死的数字', '由题目答案自动决定'], 0, '每日限制属于 Collection StudyPlan。'],
  ['0.25 写成百分数是多少？', ['2.5%', '25%', '250%'], 1, '0.25 × 100% = 25%。'],
  ['下列哪个 HTML 元素天然可通过 Tab 聚焦？', ['button', 'div', 'span', 'meta'], 0, '标准 button 是原生可交互控件。'],
  ['反馈不能只依赖颜色的主要原因是？', ['减少文件大小', '保证不同视觉能力用户都能理解', '提高网络速度'], 1, '文本语义能让反馈对更多用户可理解。'],
  ['Which number is prime?', ['9', '15', '17', '21'], 2, '17 只有 1 和 17 两个正因数。'],
  ['如果选项尚未选择，提交按钮最合理的状态是？', ['禁用并说明需要选择', '自动选择第一项'], 0, null],
  ['“MASTERED”操作的含义更接近？', ['一个答案选项', '让项目退出普通复习队列', '删除全部学习历史'], 1, '掌握是显式学习动作，不删除历史。'],
  ['下列哪项最能验证重启连续性？', ['刷新颜色', '保存、重启、恢复后队列与进度一致', '增加一张图片'], 1, '持久化验收关注真实状态恢复。'],
  ['10 ÷ 2 + 1 的结果是？', ['3', '5', '6', '11'], 2, '先除法后加法：10 ÷ 2 + 1 = 6。'],
  ['多集合统计最少应保留什么？', ['无上下文总数', '按 Collection 的明细', '随机预测'], 1, '总览可以聚合，但必须保留 Collection breakdown。'],
  ['Source classification for this pack is:', ['SYNTHETIC', 'OFFICIAL', 'UNKNOWN'], 0, null],
  ['一个可回滚导入在写入前应先创建什么？', ['Pre-Import Restore Point', '公开链接', '新账号'], 0, '安全导入先建立可验证恢复点。'],
  ['如果内容摘要与 Manifest 不一致，应当？', ['继续导入', '失败关闭并保持 Store 不变', '忽略摘要'], 1, '摘要不一致必须 fail closed。'],
  ['这组题目的 PUBLIC_EXAM_AUTHORITY 是？', ['NONE', '某国家机关', '未知官方机构'], 0, '本包是合成验证内容，不代表任何考试机构。'],
];

export const SYNTHETIC_MULTIPLE_CHOICE_CONTENTS = Object.freeze(DEFINITIONS.map(([question, options, answerIndex, explanation], index) => createMultipleChoiceContent({
  contentId: `mc:validation:${String(index + 1).padStart(3, '0')}`,
  contentType: 'multiple_choice',
  question: `${MULTIPLE_CHOICE_VALIDATION_MARKER}: ${question}`,
  answer: options[answerIndex],
  options,
  correctAnswer: options[answerIndex],
  explanation,
  tags: ['test', 'synthetic', 'product-validation', `fixture-${index + 1}`],
  sourceRef: 'synthetic:multiple-choice-validation-pack',
  createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
  updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
})));

export const SYNTHETIC_MULTIPLE_CHOICE_COLLECTION = createStudyCollection({
  collectionId: MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID,
  type: StudyCollectionType.QUESTION_BANK,
  title: MULTIPLE_CHOICE_VALIDATION_PACK_NAME,
  description: 'TEST / SYNTHETIC product and architecture validation fixture; not an official examination question bank.',
  source: 'synthetic:multiple-choice-validation-pack',
  createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
  updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
});

export const SYNTHETIC_MULTIPLE_CHOICE_MANIFEST = createStudyContentPackageManifest({
  packageId: 'multiple-choice-validation-pack-v0-1',
  packageVersion: '0.1',
  collectionId: MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID,
  contentType: 'multiple_choice',
  itemCount: SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.length,
  contentDigest: calculateStudyContentDigest(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS),
  provenance: {
    sourceId: 'synthetic:multiple-choice-validation-pack',
    classification: GenericStudySourceClassification.SYNTHETIC,
    title: MULTIPLE_CHOICE_VALIDATION_PACK_NAME,
    official: false,
    publicExamAuthority: null,
    originUrl: null,
    licenseId: null,
    evidenceRefs: ['fixture:synthetic-multiple-choice-validation-pack'],
    acquiredAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
    permissions: { localStorage: true, modification: true, redistribution: false },
    notes: MULTIPLE_CHOICE_VALIDATION_MARKER,
  },
  createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
});

export const SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT = JSON.stringify({
  schemaVersion: '0.1',
  contents: SYNTHETIC_MULTIPLE_CHOICE_CONTENTS,
});
