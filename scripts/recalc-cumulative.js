// 累计超限口径修复后的重算脚本（只读，不改 data/db.json）：
// 对每个已有批次，对照「旧口径（只算入库那个月）」与「新口径（按批次周期累计、跨月不重置）」，
// 列出累计超限与判定结论发生变化的批次，并标出哪些是跨月批次。
// 用法：node scripts/recalc-cumulative.js
const store = require('../server/store');
const coldlib = require('../server/coldlib');

// 修复前的旧口径：只计入库那个月里的超限段
function oldMonthlyMinutes(data, batchId) {
  const rows = coldlib.effectiveRecords(data, batchId);
  if (!rows.length) return 0;
  const month = String(rows[0].at).slice(0, 7);
  const scoped = rows.filter((r) => String(r.at).slice(0, 7) === month);
  return coldlib.segmentStats(scoped, data.settings).totalMinutes;
}

function monthsOf(data, batchId) {
  const set = new Set();
  for (const r of coldlib.effectiveRecords(data, batchId)) set.add(String(r.at).slice(0, 7));
  return Array.from(set).sort();
}

const data = store.load();
const limit = Number(data.settings.allowTotalExcursionMinutes);

const rows = data.batches.map((batch) => {
  const check = coldlib.releaseCheck(data, batch);
  const stats = coldlib.excursionStats(data, batch.id);
  const chain = check.chain;
  const oldTotal = oldMonthlyMinutes(data, batch.id);
  const newTotal = check.totalMinutes;
  // 旧判定：三条里只有累计这一条的数据源不同，其余两条沿用同一套算法
  const oldConditionsOk =
    stats.longestMinutes <= Number(data.settings.allowExcursionMinutes) &&
    oldTotal <= limit &&
    chain.gapCount === 0;
  const months = monthsOf(data, batch.id);
  return {
    code: batch.code,
    status: batch.status,
    crossMonth: months.length > 1,
    months: months.join('、') || '（无记录）',
    oldTotal,
    newTotal,
    oldPass: oldConditionsOk,
    newPass: check.pass,
    totalChanged: oldTotal !== newTotal,
    passChanged: oldConditionsOk !== check.pass,
  };
});

console.log('累计超限重算（阈值 ' + limit + ' 分钟；旧口径＝只算入库月，新口径＝按批次周期累计、跨月不重置）');
console.log('');
for (const r of rows) {
  console.log(
    r.code +
    ' [' + r.status + ']' +
    (r.crossMonth ? ' 【跨月：' + r.months + '】' : ' [' + r.months + ']') +
    ' 累计 ' + r.oldTotal + ' → ' + r.newTotal + ' 分钟' +
    '，判定 ' + (r.oldPass ? '满足' : '不满足') + ' → ' + (r.newPass ? '满足' : '不满足') +
    ((r.totalChanged || r.passChanged) ? '  ★有变化' : '')
  );
}

const changed = rows.filter((r) => r.totalChanged || r.passChanged);
console.log('');
console.log('发生变化的批次：' + changed.length + ' 个');
for (const r of changed) {
  console.log(
    '- ' + r.code +
    '：累计 ' + r.oldTotal + ' → ' + r.newTotal + ' 分钟' +
    '，判定 ' + (r.oldPass ? '满足' : '不满足') + ' → ' + (r.newPass ? '满足' : '不满足') +
    (r.crossMonth ? '（跨月批次，' + r.months + '）' : '（单月批次）')
  );
}
const crossChanged = changed.filter((r) => r.crossMonth);
console.log('其中跨月批次：' + (crossChanged.length ? crossChanged.map((r) => r.code).join('、') : '无'));
console.log('');
console.log('说明：页面与接口的所有累计/判定都是实时算的，本次修复后已自动生效；放行台账里的是决定当时的历史快照，按口径保留不改。');
