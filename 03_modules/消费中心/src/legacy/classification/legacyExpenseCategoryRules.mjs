// Legacy source: src/shared/expense.js @ 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Assets: LEGACY-CLASSIFIER-RULES-V1 (EXTRACT_AND_ADAPT) and shared compat helpers.
// Migration: behavior-preserving CJS -> ESM extraction; do not independently rewrite.

export const LEGACY_CLASSIFICATION_ASSET_ID = 'LEGACY-CLASSIFIER-RULES-V1';
export const LEGACY_RULE_SET = 'legacy-default-v1';

export const DEFAULT_CATEGORY_RULES = Object.freeze([
  {
    order: 1,
    category: 'food',
    label: '餐饮',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['美团', '饿了么', '麦当劳', '肯德基', '星巴克', '瑞幸', '海底捞', '喜茶', '蜜雪冰城', '咖啡', '食堂', '餐厅', '外卖'] },
      ] },
      { predicates: [
        { field: 'category', values: ['餐饮', '食品酒饮', '午餐', '晚餐', '早餐', '饮品'] },
      ] },
    ],
  },
  {
    order: 2,
    category: 'transport',
    label: '交通',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['滴滴', '高德', '地铁', '公交', '12306', '铁路', '航空公司', '中国石油', '中国石化'] },
      ] },
      { predicates: [
        { field: 'category', values: ['交通出行', '出行', '加油', '打车', '火车票', '机票'] },
      ] },
    ],
  },
  {
    order: 3,
    category: 'shopping',
    label: '购物',
    matchers: [
      { predicates: [
        { field: 'merchant', values: ['淘宝', '天猫', '京东', '拼多多', '唯品会', '抖音商城', '得物'] },
      ] },
      { predicates: [
        { field: 'category', values: ['购物', '日用商品', '服饰', '家用电器', '数码'] },
      ] },
    ],
  },
  {
    order: 4,
    category: 'entertainment',
    label: '娱乐',
    matchers: [
      { predicates: [
        { field: 'category', values: ['文化休闲', '影视', '游戏', '休闲娱乐'] },
      ] },
      { predicates: [
        { field: 'merchant', values: ['bilibili', '哔哩哔哩', '腾讯视频', '爱奇艺', '网易云音乐', 'Steam', '腾讯游戏'] },
      ] },
    ],
  },
  {
    order: 5,
    category: 'medical',
    label: '医疗',
    matchers: [
      { predicates: [
        { field: 'category', values: ['医疗健康', '医药', '医疗'] },
      ] },
      { predicates: [
        { field: 'merchant', values: ['医院', '药店', '大药房', '诊所'] },
      ] },
    ],
  },
  {
    order: 6,
    category: 'housing',
    label: '居住',
    matchers: [
      { predicates: [
        { field: 'category', values: ['住房缴费', '房租', '水电燃气'] },
      ] },
      { predicates: [
        { field: 'merchant', values: ['房租', '物业', '燃气', '水务', '国家电网', '南方电网'] },
      ] },
    ],
  },
  {
    order: 7,
    category: 'digital',
    label: '数码服务',
    matchers: [
      { predicates: [
        { field: 'category', values: ['手机通讯', '通讯', '云服务', '软件服务', '会员'] },
      ] },
      { predicates: [
        { field: 'merchant', values: ['中国移动', '中国联通', '中国电信', 'Apple', 'iCloud', '腾讯云', '阿里云', 'GitHub', 'JetBrains'] },
      ] },
    ],
  },
  {
    order: 8,
    category: 'education',
    label: '教育',
    matchers: [
      { predicates: [
        { field: 'category', values: ['教育培训', '教育', '学习'] },
      ] },
    ],
  },
  {
    order: 9,
    category: 'salary',
    label: '工资',
    matchers: [
      { predicates: [
        { field: 'direction', values: ['income'] },
      ] },
      { predicates: [
        { field: 'category', values: ['工资', '薪资'] },
      ] },
    ],
  },
  {
    order: 10,
    category: 'other',
    label: '其他',
    matchers: [],
  },
]);

export function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeDirection(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'income' || raw === 'refund' || raw === 'in') return 'income';
  if (raw === 'expense' || raw === 'out') return 'expense';
  if (raw.includes('收') || raw.includes('入')) return 'income';
  if (raw.includes('支') || raw.includes('出')) return 'expense';
  return 'expense';
}

export function normalizeCategory(value) {
  const raw = String(value || '').trim();
  return raw || 'other';
}

export function classifyExpense(record, options = {}) {
  const autoCategorize = options.autoCategorize !== false;
  const target = isObject(record) ? record : {};
  const category = normalizeCategory(target.category);
  if (!autoCategorize) return category === 'other' ? 'other' : category;
  if (category !== 'other') return category;
  for (const rule of DEFAULT_CATEGORY_RULES) {
    let matched = false;
    for (const matcher of rule.matchers) {
      if (!matcher || !Array.isArray(matcher.predicates)) continue;
      let all = true;
      for (const predicate of matcher.predicates) {
        const fieldValue = predicate.field === 'direction'
          ? normalizeDirection(target.direction)
          : String(target[predicate.field] || '').trim().toLowerCase();
        const values = Array.isArray(predicate.values) ? predicate.values : [];
        const hit = values.some((value) => fieldValue && fieldValue.toLowerCase().includes(String(value).toLowerCase()));
        if (!hit) { all = false; break; }
      }
      if (all) { matched = true; break; }
    }
    if (matched) return rule.category;
  }
  return 'other';
}
