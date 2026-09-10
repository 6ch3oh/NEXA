'use strict';
const MOBILE_PRODUCT_ENDPOINT = '/nexa/mobile/product';
const MOBILE_PRODUCT_CONTRACT_VERSION = '0.1';
const MOBILE_PRODUCT_OPERATIONS = Object.freeze([
  'calendar.month', 'calendar.day', 'calendar.propose', 'calendar.confirm', 'calendar.cancel',
  'bills.query', 'bills.statistics', 'bills.drafts', 'bills.confirm-draft', 'bills.update-draft', 'bills.ignore-draft',
  'ai.expense-query', 'global-command.submit', 'global-command.confirm', 'global-command.cancel',
  'notifications.status', 'notifications.query', 'status'
]);
module.exports = { MOBILE_PRODUCT_CONTRACT_VERSION, MOBILE_PRODUCT_ENDPOINT, MOBILE_PRODUCT_OPERATIONS };
