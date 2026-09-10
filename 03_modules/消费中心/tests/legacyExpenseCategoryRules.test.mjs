import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CATEGORY_RULES,
  classifyExpense,
} from '../src/legacy/classification/legacyExpenseCategoryRules.mjs';

test('legacy rule order and income/merchant matching are preserved', () => {
  assert.deepEqual(DEFAULT_CATEGORY_RULES.map((rule) => rule.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(classifyExpense({ merchant: '美团外卖' }), 'food');
  assert.equal(classifyExpense({ merchant: '滴滴出行' }), 'transport');
  assert.equal(classifyExpense({ direction: 'income' }), 'salary');
  assert.equal(classifyExpense({ merchant: '随机小铺' }), 'other');
});

test('legacy food keywords match generically and explicit category wins', () => {
  for (const merchant of ['测试咖啡店', '公司食堂', '楼下餐厅', '跑腿外卖', '星巴克咖啡']) {
    assert.equal(classifyExpense({ merchant }), 'food');
  }
  assert.equal(classifyExpense({ merchant: '维修点' }), 'other');
  assert.equal(classifyExpense({ merchant: '测试咖啡店', category: 'transport' }), 'transport');
});

test('legacy auto-categorize off preserves explicit category and leaves unknown other', () => {
  assert.equal(classifyExpense({ merchant: '美团外卖' }, { autoCategorize: false }), 'other');
  assert.equal(classifyExpense({ merchant: '美团外卖', category: 'food' }, { autoCategorize: false }), 'food');
});
