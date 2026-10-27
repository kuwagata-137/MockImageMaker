'use strict';
// kintone の MCP サーバー（GitHub の kintone/mcp-server。2026-10-26 に見た版）の道具の入力の形を、get_kintone_app の返事と見比べるために写したもの（第 13 段階）。
// kintone-add-form-fields の properties（フィールドコード → フィールドの設定）と、kintone-update-form-layout の layout。
// 元の形は知らない欄を黙って捨てるが、ここでは綴りの誤りを見つけるため、知らない欄を断る（strict）。
// 元の形が変わったら、ここも直す（元の src/tools/kintone/app と src/schema/app の形）。

const { z } = require('zod');

const o = (shape) => z.object(shape).strict();
const s = z.string();
const b = z.boolean();
const opt = (x) => x.optional();
const field = (type, extra = {}) => o({ type: z.literal(type), code: s, label: s, noLabel: opt(b), ...extra });
const req = { required: opt(b) };
const options = z.record(s, o({ label: s, index: s }));
const unit = { unit: opt(s), unitPosition: opt(z.enum(['BEFORE', 'AFTER'])) };
const align = opt(z.enum(['HORIZONTAL', 'VERTICAL']));
const text = { ...req, defaultValue: opt(s), unique: opt(b), minLength: opt(s), maxLength: opt(s) };
const fn = (code) => o({ code: z.literal(code), type: z.literal('FUNCTION') });
const entity = (...types) => o({ code: s, type: z.enum(types) });

// テーブルの中に置けるフィールド
const LOOKUP = o({
  relatedApp: o({ app: s, code: s }), relatedKeyField: s, fieldMappings: z.array(o({ field: s, relatedField: s })),
  lookupPickerFields: z.array(s), filterCond: s, sort: s,
});
const IN_TABLE = [
  o({ type: z.enum(['SINGLE_LINE_TEXT', 'NUMBER']), code: s, label: s, noLabel: opt(b), ...req, lookup: LOOKUP }),
  field('SINGLE_LINE_TEXT', { ...text, expression: opt(s), hideExpression: opt(b) }),
  field('NUMBER', { ...req, defaultValue: opt(s), unique: opt(b), minValue: opt(s), maxValue: opt(s), digit: opt(b), displayScale: opt(s), ...unit }),
  field('CALC', { ...req, expression: opt(s), hideExpression: opt(b), format: opt(z.enum(['NUMBER', 'NUMBER_DIGIT', 'DATETIME', 'DATE', 'TIME', 'HOUR_MINUTE', 'DAY_HOUR_MINUTE'])), displayScale: opt(s), ...unit }),
  field('MULTI_LINE_TEXT', { ...req, defaultValue: opt(s) }),
  field('RICH_TEXT', { ...req, defaultValue: opt(s) }),
  field('LINK', { ...text, protocol: opt(z.enum(['WEB', 'CALL', 'MAIL'])) }),
  field('CHECK_BOX', { ...req, defaultValue: opt(z.array(s)), options: opt(options), align }),
  field('RADIO_BUTTON', { ...req, defaultValue: opt(s), options: opt(options), align }),
  field('DROP_DOWN', { ...req, defaultValue: opt(s), options: opt(options) }),
  field('MULTI_SELECT', { ...req, defaultValue: opt(z.array(s)), options: opt(options) }),
  field('FILE', { ...req, thumbnailSize: opt(z.enum(['50', '150', '250', '500'])) }),
  field('DATE', { ...req, defaultValue: opt(s), unique: opt(b), defaultNowValue: opt(b) }),
  field('TIME', { ...req, defaultValue: opt(s), defaultNowValue: opt(b) }),
  field('DATETIME', { ...req, defaultValue: opt(s), unique: opt(b), defaultNowValue: opt(b) }),
  field('USER_SELECT', { ...req, defaultValue: opt(z.array(z.union([entity('USER', 'GROUP', 'ORGANIZATION'), fn('LOGINUSER()')]))), entities: opt(z.array(entity('USER', 'GROUP', 'ORGANIZATION'))) }),
  field('ORGANIZATION_SELECT', { ...req, defaultValue: opt(z.array(z.union([entity('ORGANIZATION'), fn('PRIMARY_ORGANIZATION()')]))), entities: opt(z.array(entity('ORGANIZATION'))) }),
  field('GROUP_SELECT', { ...req, defaultValue: opt(z.array(entity('GROUP'))), entities: opt(z.array(entity('GROUP'))) }),
];
const SYSTEM = ['RECORD_NUMBER', 'CREATOR', 'MODIFIER', 'CREATED_TIME', 'UPDATED_TIME'].map((t) => field(t));
const REFERENCE_TABLE = field('REFERENCE_TABLE', {
  referenceTable: opt(o({
    relatedApp: o({ app: s, code: s }), condition: o({ field: s, relatedField: s }), filterCond: s, displayFields: z.array(s), sort: s,
    size: z.enum(['1', '3', '5', '10', '20', '30', '40', '50']),
  })),
});
const SUBTABLE = field('SUBTABLE', { fields: opt(z.record(s, z.union(IN_TABLE))) });
// グループ（第 14 段階で写した。2026-10-27 に見た版の groupSchema）
const GROUP = field('GROUP', { openGroup: opt(b) });
const property = z.union([...SYSTEM, ...IN_TABLE, REFERENCE_TABLE, SUBTABLE, GROUP]);
const properties = z.record(s, property);

// フォームの並び（kintone-update-form-layout の layout）
const LAYOUT_TYPES = [
  'SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT', 'NUMBER', 'CALC', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT', 'DROP_DOWN', 'USER_SELECT',
  'ORGANIZATION_SELECT', 'GROUP_SELECT', 'DATE', 'TIME', 'DATETIME', 'LINK', 'FILE', 'SUBTABLE', 'RECORD_NUMBER', 'CREATOR', 'CREATED_TIME', 'MODIFIER',
  'UPDATED_TIME', 'STATUS', 'STATUS_ASSIGNEE', 'CATEGORY', 'REFERENCE_TABLE', 'GROUP', 'LABEL', 'SPACER', 'HR',
];
const num = z.union([s, z.number()]);
const layoutField = o({ type: z.enum(LAYOUT_TYPES), code: opt(s), label: opt(s), elementId: opt(s), size: opt(o({ width: opt(num), height: opt(num), innerHeight: opt(num) })) });
const row = o({ type: z.literal('ROW'), fields: z.array(layoutField) });
const layout = z.array(z.union([row, o({ type: z.literal('SUBTABLE'), code: s, fields: z.array(layoutField) }), o({ type: z.literal('GROUP'), code: s, layout: z.array(row) })]));

// kintone-add-app・kintone-update-general-settings（使う欄だけ）
const addApp = o({ name: s.min(1).max(64), space: opt(z.number()) });
const generalSettings = o({ name: opt(s.min(1).max(64)), description: opt(s.max(10000)) });

module.exports = { properties, layout, addApp, generalSettings };
