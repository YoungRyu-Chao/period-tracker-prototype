const screen = document.querySelector('#screen');
const tabs = [...document.querySelectorAll('.tab')];
const dialog = document.querySelector('#recordDialog');
const form = document.querySelector('#recordForm');
const toast = document.querySelector('#toast');
const noPeriodDialog = document.querySelector('#noPeriodDialog');
const cancelNoPeriod = document.querySelector('#cancelNoPeriod');
const confirmNoPeriod = document.querySelector('#confirmNoPeriod');
const quickFlowDialog = document.querySelector('#quickFlowDialog');
const importFile = document.querySelector('#importFile');
const importDialog = document.querySelector('#importDialog');
const exportDialog = document.querySelector('#exportDialog');
const importSummary = document.querySelector('#importSummary');
const importFileName = document.querySelector('#importFileName');
const cycleSettingsDialog = document.querySelector('#cycleSettingsDialog');
const cycleSettingsForm = document.querySelector('#cycleSettingsForm');
const reminderDialog = document.querySelector('#reminderDialog');
const reminderForm = document.querySelector('#reminderForm');
const updateDialog = document.querySelector('#updateDialog');
const installHelpDialog = document.querySelector('#installHelpDialog');
let pendingImport = null;
let installPrompt = null;
let waitingWorker = null;
let pwaRegistration = null;
let reloadingForUpdate = false;
let trendLimit = 6;
let formUsageTimes = { pads: [], tampons: [] };
let recordApplyMode = 'single';
const appScriptUrl = document.querySelector('script[src$="app.js"]')?.src;
const assetBaseUrl = new URL('.', appScriptUrl || document.baseURI);
const assetUrl = filename => new URL(filename, assetBaseUrl).href;

const STORE_KEY = 'zhiqi-records-v2';
const SETTINGS_KEY = 'zhiqi-settings-v2';
const BACKUP_META_KEY = 'zhiqi-backup-meta-v2';
const DB_NAME = 'zhiqi-durable-backup';
const DB_STORE = 'snapshots';
const todayDate = new Date();
todayDate.setHours(12, 0, 0, 0);
let activePage = 'today';
let selectedDate = toKey(todayDate);
let calendarCursor = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
let batchMode = false;
let batchDates = [];
let recordTargets = [selectedDate];
let records = load(STORE_KEY, {});
const defaultSettings = () => ({ cycleLength: 28, periodLength: 5, lastPeriodStart: offsetKey(todayDate, -17), reminder: true, excludedCycles: [], periodReminder: false, periodReminderDays: 2, recordReminder: false, recordReminderTime: '20:00', largeText: false });
let settings = load(SETTINGS_KEY, defaultSettings());
settings = { ...defaultSettings(), ...settings, excludedCycles: Array.isArray(settings.excludedCycles) ? settings.excludedCycles : [] };

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(records));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const snapshot = { records, settings, savedAt: new Date().toISOString(), version: 2 };
  localStorage.setItem(BACKUP_META_KEY, snapshot.savedAt);
  saveDurableSnapshot('latest', snapshot);
}
function openBackupDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveDurableSnapshot(id, snapshot = { records, settings, savedAt: new Date().toISOString(), version: 2 }) {
  try {
    const db = await openBackupDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(snapshot)), id);
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch { /* 主存储仍可正常使用 */ }
}
async function readDurableSnapshot(id = 'latest') {
  try {
    const db = await openBackupDb();
    const snapshot = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close(); return snapshot;
  } catch { return null; }
}
async function recoverIfNeeded() {
  if (Object.keys(records).length) return false;
  const snapshot = await readDurableSnapshot('latest');
  if (!snapshot?.records || !Object.keys(snapshot.records).length) return false;
  records = snapshot.records;
  settings = { ...defaultSettings(), ...(snapshot.settings || {}) };
  localStorage.setItem(STORE_KEY, JSON.stringify(records));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  return true;
}
function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function fromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function offsetKey(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return toKey(next); }
function daysBetween(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 86400000); }
function cnDate(date, withWeek = false) {
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  return withWeek ? `${base} · 周${'日一二三四五六'[date.getDay()]}` : base;
}
function periodStarts() {
  return Object.keys(records).filter(key => records[key]?.period === 'yes' && records[offsetKey(fromKey(key), -1)]?.period !== 'yes').sort();
}
function cyclePosition(key, starts = periodStarts()) {
  const previousStart = [...starts].reverse().find(start => start <= key);
  if (!previousStart) {
    const raw = daysBetween(settings.lastPeriodStart, key);
    return { day: ((raw % settings.cycleLength) + settings.cycleLength) % settings.cycleLength + 1, start: settings.lastPeriodStart, actual: false };
  }
  const rawDay = daysBetween(previousStart, key) + 1;
  const isFutureEstimate = key > toKey(todayDate);
  return { day: isFutureEstimate ? ((rawDay - 1) % settings.cycleLength) + 1 : rawDay, start: previousStart, actual: !isFutureEstimate };
}
function cycleDay(key, starts) {
  return cyclePosition(key, starts).day;
}
function actualPeriodDay(key) {
  if (records[key]?.period !== 'yes') return 0;
  return periodRange(key).indexOf(key) + 1;
}
function nextPeriodDate() {
  let next = fromKey(settings.lastPeriodStart);
  while (next <= todayDate) next.setDate(next.getDate() + settings.cycleLength);
  return toKey(next);
}
function predictionWindow() {
  const metrics = cycleMetrics();
  const usable = metrics.includedIntervals.slice(-6);
  const irregular = usable.length >= 3 && Math.max(...usable) - Math.min(...usable) >= 7;
  if (!irregular) { const key = nextPeriodDate(); return { start: key, end: key, irregular: false }; }
  const anchor = fromKey(settings.lastPeriodStart);
  let start = offsetKey(anchor, Math.min(...usable)), end = offsetKey(anchor, Math.max(...usable));
  while (fromKey(end) <= todayDate) { start = offsetKey(fromKey(start), settings.cycleLength); end = offsetKey(fromKey(end), settings.cycleLength); }
  return { start, end, irregular: true };
}
function formatPredictionWindow(window) {
  return window.irregular ? `${cnDate(fromKey(window.start))}–${cnDate(fromKey(window.end))}` : cnDate(fromKey(window.start));
}
function relativeDays(key) { return daysBetween(toKey(todayDate), key); }
function phaseInfo(key, starts) {
  const recordedDay = actualPeriodDay(key);
  if (recordedDay) return { id: 'period-phase', name: '经期', detail: `实际第 ${recordedDay} 天`, day: recordedDay, actual: true };
  const day = cycleDay(key, starts);
  const ovulationDay = Math.max(settings.periodLength + 2, settings.cycleLength - 14);
  const lateLutealStart = Math.max(ovulationDay + 2, settings.cycleLength - 6);
  if (day <= settings.periodLength) return { id: 'period-phase', name: '经期', detail: `预计第 ${day} 天`, day, actual: false };
  if (day <= ovulationDay) return { id: 'follicular', name: '卵泡期', detail: `预计排卵日前 · 周期第 ${day} 天`, day, actual: false };
  if (day < lateLutealStart) return { id: 'early-luteal', name: '黄体前期', detail: `预计排卵后 · 周期第 ${day} 天`, day, actual: false };
  return { id: 'late-luteal', name: '黄体后期', detail: `预计经期前 · 周期第 ${day} 天`, day, actual: false };
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

const row = (icon, title, desc, action = '') => `<button class="row" ${action ? `data-action="${action}"` : ''}><span class="row-icon">${icon}</span><span class="row-copy"><b>${title}</b><small>${desc}</small></span><span class="chev">›</span></button>`;

function weekStrip() {
  return `<div class="week" aria-label="可左右滑动选择日期">${Array.from({ length: 21 }, (_, i) => {
    const date = new Date(todayDate); date.setDate(todayDate.getDate() - 10 + i);
    const isToday = toKey(date) === toKey(todayDate);
    return `<button class="day ${isToday ? 'current' : ''}" data-date="${toKey(date)}" ${isToday ? 'data-today="true"' : ''}>${'日一二三四五六'[date.getDay()]}<b>${date.getDate()}</b></button>`;
  }).join('')}</div>`;
}

const phaseShape = id => `<i class="phase-shape ${id}" aria-hidden="true"></i>`;

function phaseTrack(active) {
  return `<div class="phase-track" aria-label="预计周期阶段">
    <span class="${active === 'follicular' ? 'active' : ''}">${phaseShape('follicular')}卵泡期</span>
    <span class="${active === 'early-luteal' ? 'active' : ''}">${phaseShape('early-luteal')}黄体前期</span>
    <span class="${active === 'late-luteal' ? 'active' : ''}">${phaseShape('late-luteal')}黄体后期</span>
  </div>`;
}

function today() {
  const todayKey = toKey(todayDate);
  const record = records[todayKey];
  const next = nextPeriodDate();
  const nextWindow = predictionWindow();
  const daysToNext = relativeDays(next);
  const phase = phaseInfo(todayKey);
  const symptomText = record?.symptoms?.length ? record.symptoms.join('、') : '尚未记录';
  const periodText = record?.period === 'yes' ? `今天有经期 · ${flowName(record.flow)}` : record?.period === 'no' ? '今天没有来' : `本周期预计 ${settings.periodLength} 天`;
  const productText = usageText(record);
  return `<div class="topline"><div><h1>今天</h1><div class="date">${cnDate(todayDate, true)}</div></div><button class="privacy" aria-label="隐私模式" data-action="privacy">◉</button></div>
    ${weekStrip()}
    <div class="cycle"><div class="cycle-content"><small>${phase.actual ? phase.name : `预计${phase.name}`}</small><strong>第 ${phase.day} 天</strong><span>${daysToNext >= 0 ? `预计 ${daysToNext} 天后` : '请更新经期日期'}</span></div></div>
    <div class="phase-card"><div>${phaseShape(phase.id)}<div><b>${phase.actual ? phase.name : `预计${phase.name}`}</b><small>${phase.detail}</small></div></div><small class="estimate">${phase.actual ? '已记录' : '仅为估算'}</small></div>
    ${phaseTrack(phase.id)}
    <div class="quick-period"><div><b>今天月经来了吗？</b><small>${record?.period ? '已记录，可随时修改' : '一秒完成快速记录'}</small></div><div class="quick-actions"><button data-action="quick-period" data-value="yes" class="${record?.period === 'yes' ? 'active' : ''}">来了</button><button data-action="quick-period" data-value="no" class="${record?.period === 'no' ? 'active' : ''}">没有</button></div></div>
    <button class="primary" data-action="record" data-date="${todayKey}">${record ? '补充详细记录' : '记录更多感受'}</button>
    <p class="prediction">${nextWindow.irregular ? '周期波动较大，预计下次经期范围' : '预计下次经期'} <b>${formatPredictionWindow(nextWindow)}</b></p>
    <h2 class="section-title">今日记录</h2><div class="list">${row('♡', '症状与感受', symptomText, 'record')}${row('◔', '经期记录', periodText, 'record')}${row('▤', '月经用品', productText, 'record')}${row('⌁', '周期趋势', `平均周期 ${settings.cycleLength} 天`, 'trends')}</div>`;
}

function calendar() {
  const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const predictedStart = nextPeriodDate();
  const starts = periodStarts();
  const cells = Array.from({ length: firstDay }, () => '<span></span>');
  for (let day = 1; day <= total; day++) {
    const date = new Date(year, month, day, 12), key = toKey(date), record = records[key];
    const predictedOffset = daysBetween(predictedStart, key);
    const phase = phaseInfo(key, starts);
    const isRecordedPeriod = record?.period === 'yes';
    const classes = [isRecordedPeriod ? 'period' : '', !isRecordedPeriod && predictedOffset >= 0 && predictedOffset < settings.periodLength ? 'predicted' : '', key === selectedDate && !batchMode ? 'selected' : '', batchDates.includes(key) ? 'batch-selected' : '', !isRecordedPeriod ? `phase-${phase.id}` : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" data-date="${key}" aria-label="${cnDate(date)}，${isRecordedPeriod ? `实际经期第 ${actualPeriodDay(key)} 天` : `预计${phase.name}`}${record ? '，已有记录' : ''}">${day}</button>`);
  }
  const selectedRecord = records[selectedDate];
  const selectedPhase = phaseInfo(selectedDate, starts);
  const summary = selectedRecord ? [selectedRecord.period === 'yes' ? `经期·${flowName(selectedRecord.flow)}` : '非经期', usageText(selectedRecord, true), ...(selectedRecord.symptoms || []), selectedRecord.mood].filter(Boolean).join(' · ') : '尚未记录这一天';
  const batchPanel = batchMode ? `<div class="batch-panel"><span><b>已选 ${batchDates.length} 天</b><small>再次点击可取消</small></span><button data-action="batch-record" ${batchDates.length ? '' : 'disabled'}>批量记录</button></div>` : '';
  return `<div class="calendar-title"><div><h1 class="page-title">日历</h1><div class="subtle">${batchMode ? '点击多个日期进行批量记录' : '查看阶段预测或补充记录'}</div></div><button class="multi-toggle ${batchMode ? 'active' : ''}" data-action="toggle-batch">${batchMode ? '取消多选' : '多选日期'}</button></div>
    <div class="calendar-head"><button data-action="prev-month" aria-label="上个月">‹</button><b>${year}年${month + 1}月</b><button data-action="next-month" aria-label="下个月">›</button></div>
    <div class="month"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>${cells.join('')}</div>
    <div class="phase-legend" aria-label="阶段图例"><span><i class="phase-shape period-phase"></i>经期</span><span><i class="predicted-ring"></i>预测经期</span><span>${phaseShape('follicular')}卵泡期</span><span>${phaseShape('early-luteal')}黄体前期</span><span>${phaseShape('late-luteal')}黄体后期</span></div>
    ${batchPanel}
    ${batchMode ? '' : `<div class="insight"><h3>${cnDate(fromKey(selectedDate))} · ${selectedPhase.actual ? `经期第 ${selectedPhase.day} 天` : `预计${selectedPhase.name}`}</h3><p class="subtle">${selectedPhase.actual ? `本次经期第 ${selectedPhase.day} 天` : `周期第 ${selectedPhase.day} 天`} · ${summary}</p><button class="primary" data-action="record" data-date="${selectedDate}">${selectedRecord ? '编辑记录' : '补充记录'}</button></div>`}`;
}

function trends() {
  const periodRecords = Object.entries(records).filter(([, r]) => r.period === 'yes');
  const metrics = cycleMetrics();
  const frequency = {};
  Object.values(records).forEach(record => {
    (record.symptoms || []).forEach(item => frequency[item] = (frequency[item] || 0) + 1);
    if (record.mood) frequency[`情绪·${record.mood}`] = (frequency[`情绪·${record.mood}`] || 0) + 1;
  });
  const topFrequency = Object.entries(frequency).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxFrequency = topFrequency[0]?.[1] || 1;
  const totalPads = Object.values(records).reduce((sum, record) => sum + safeCount(record.pads), 0);
  const totalTampons = Object.values(records).reduce((sum, record) => sum + safeCount(record.tampons), 0);
  const cycleSeed = metrics.includedIntervals.length ? metrics.includedIntervals.slice(-trendLimit) : [settings.cycleLength - 1, settings.cycleLength + 1, settings.cycleLength, settings.cycleLength - 2, settings.cycleLength + 2, settings.cycleLength];
  const minCycle = Math.min(...cycleSeed), maxCycle = Math.max(...cycleSeed);
  const heights = cycleSeed.map(value => maxCycle === minCycle ? 72 : Math.round(52 + ((value - minCycle) / (maxCycle - minCycle)) * 40));
  const chartLabels = metrics.intervalDetails.filter(item => !(settings.excludedCycles || []).includes(item.end)).slice(-trendLimit).map(item => `${fromKey(item.end).getMonth() + 1}月`);
  const phaseIds = ['period-phase', 'follicular', 'early-luteal', 'late-luteal'];
  const phaseNames = { 'period-phase': '经期', follicular: '卵泡期', 'early-luteal': '黄体前期', 'late-luteal': '黄体后期' };
  const phaseSummary = phaseIds.map(id => {
    const counts = {};
    Object.entries(records).forEach(([key, record]) => {
      if (phaseInfo(key).id !== id) return;
      (record.symptoms || []).forEach(item => counts[item] = (counts[item] || 0) + 1);
      if (record.mood) counts[`情绪·${record.mood}`] = (counts[`情绪·${record.mood}`] || 0) + 1;
    });
    const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return `<div class="phase-insight">${phaseShape(id)}<span><b>${phaseNames[id]}</b><small>${common ? `${common[0]} · ${common[1]} 次` : '暂无症状记录'}</small></span></div>`;
  }).join('');
  const monthly = {};
  Object.entries(records).forEach(([key, record]) => {
    const month = key.slice(0, 7); monthly[month] ||= { pads: 0, tampons: 0 };
    monthly[month].pads += safeCount(record.pads); monthly[month].tampons += safeCount(record.tampons);
  });
  const monthlyEntries = Object.entries(monthly).filter(([, value]) => value.pads || value.tampons).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const monthlyMax = Math.max(1, ...monthlyEntries.flatMap(([, value]) => [value.pads, value.tampons]));
  const monthlyRows = monthlyEntries.map(([month, value]) => `<div class="monthly-row"><b>${Number(month.slice(5))}月</b><div><i class="pads-bar" style="width:${Math.round(value.pads / monthlyMax * 100)}%"></i><small>月经巾 ${value.pads}</small></div><div><i class="tampons-bar" style="width:${Math.round(value.tampons / monthlyMax * 100)}%"></i><small>棉条 ${value.tampons}</small></div></div>`).join('');
  return `<h1 class="page-title">周期趋势</h1><div class="subtle">根据已记录的经期开始日自动计算</div>
    <div class="stats"><div class="stat"><strong>${metrics.averageCycle}<small>天</small></strong><span>平均周期</span></div><div class="stat"><strong>${metrics.averagePeriod}<small>天</small></strong><span>平均经期</span></div><div class="stat"><strong>${periodRecords.length}<small>天</small></strong><span>已记录经期</span></div><div class="stat"><strong>${Object.keys(records).length}<small>天</small></strong><span>记录总数</span></div></div>
    <div class="calculation-note"><b>典型周期 ${metrics.typicalCycle} 天</b><span>预测采用中位数；平均周期采用 ${metrics.includedIntervals.length} 个未排除周期的算术平均。</span></div>
    <div class="trend-heading"><h2 class="section-title">真实周期长度</h2><div class="trend-toggle"><button data-trend-limit="6" class="${trendLimit === 6 ? 'active' : ''}">最近6次</button><button data-trend-limit="12" class="${trendLimit === 12 ? 'active' : ''}">最近12次</button></div></div>
    <div class="chart">${heights.map((h, i) => `<div class="bar ${i === heights.length - 1 ? 'active' : ''}" style="height:${h}%" data-label="${chartLabels[i] || '本次'}" data-value="${cycleSeed[i]}天"></div>`).join('')}</div>
    <h2 class="section-title">症状与情绪频率</h2><div class="frequency-list">${topFrequency.length ? topFrequency.map(([name, count]) => `<div><span><b>${name}</b><small>${count} 次</small></span><i><em style="width:${Math.round(count / maxFrequency * 100)}%"></em></i></div>`).join('') : '<p class="empty-state">记录症状和心情后，这里会显示出现频率。</p>'}</div>
    <h2 class="section-title">不同阶段对比</h2><div class="phase-comparison">${phaseSummary}</div>
    <h2 class="section-title">用品月度统计</h2><div class="usage-stats"><div><span class="usage-icon">▤</span><p><b>${totalPads}<small> 张</small></b><span>月经巾累计</span></p></div><div><span class="usage-icon tampon">▯</span><p><b>${totalTampons}<small> 支</small></b><span>棉条累计</span></p></div></div><div class="monthly-usage">${monthlyRows || '<p class="empty-state">记录用品数量后，这里会按月份统计。</p>'}</div>
    <div class="insight"><p class="subtle">统计只基于已保存的记录，记录越完整越有参考价值。</p></div>`;
}

function profile() {
  const lastSaved = localStorage.getItem(BACKUP_META_KEY);
  const savedLabel = lastSaved ? new Date(lastSaved).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '等待首次记录';
  return `<h1 class="page-title">我的</h1><div class="subtle">数据只属于你</div>
    <div class="profile-card"><h3>双重本地保护</h3><p class="subtle">${Object.keys(records).length ? `已有 ${Object.keys(records).length} 天记录同时保存在主存储与自动快照。` : '记录将在当前设备进行双重保存，不需要注册账号。'}</p><span class="save-status">● 上次自动保存：${savedLabel}</span><p class="backup-reminder">建议每月下载一次 JSON 完整备份，换手机或清理浏览器后仍可恢复。</p><button class="mini-backup" data-action="export-json">下载 JSON 完整备份</button></div>
    <h2 class="section-title profile-section">周期设置</h2><div class="list">${row('◷','调整周期', `${settings.lastPeriodStart} · 典型 ${settings.cycleLength} 天 · 经期 ${settings.periodLength} 天`,'cycle-settings')}</div>
    <h2 class="section-title profile-section">显示设置</h2><div class="list">${row('Aa','大字号', settings.largeText ? '已开启 · 点击恢复标准字号' : '已关闭 · 点击放大主要文字','toggle-large-text')}</div>
    <h2 class="section-title profile-section">数据管理</h2><div class="list">${row('⇩','导入备份','导入前预览新增、覆盖与冲突','import')}${row('↺','恢复自动快照','恢复最近一次自动保存的数据','restore-snapshot')}${row('↶','撤销最近一次导入','恢复到导入前的状态','undo-import')}${row('⇧','导出与保存','Markdown、PDF 或 JSON','export')}</div>
    <h2 class="section-title profile-section">App 与提醒</h2><div class="pwa-brand"><img src="icons/app-icon-192.png" alt="知期 App 图标"><span><b>知期 App</b><small>可安装 · 可离线使用</small></span></div><div class="list">${row('＋','安装到手机桌面', installPrompt ? '点击后直接安装，离线也能使用' : '查看一加浏览器与 Chrome 的安装步骤','install-app')}${row('⌁','提醒设置', `${settings.periodReminder ? `经期前 ${settings.periodReminderDays} 天` : '经期提醒关闭'} · ${settings.recordReminder ? `${settings.recordReminderTime} 记录提醒` : '记录提醒关闭'}`,'reminder-settings')}</div>
    <h2 class="section-title profile-section">其他</h2><div class="list">${row('↺','恢复演示数据','清除记录并恢复默认','reset')}${row('?','关于预测','了解计算方式与限制','about')}</div>
    <div class="insight"><p class="subtle">阶段和日期均为估算，不能用于诊断或替代专业医疗建议。</p></div>`;
}

function flowName(value) { return ({ light: '少量', medium: '适中', heavy: '较多' })[value] || '未记录经量'; }
function safeCount(value) { const count = Number.parseInt(value, 10); return Number.isFinite(count) ? Math.max(0, Math.min(50, count)) : 0; }
function usageText(record, compact = false) {
  const pads = safeCount(record?.pads), tampons = safeCount(record?.tampons);
  if (!pads && !tampons) return compact ? '' : '尚未记录使用数量';
  return [`月经巾 ${pads} 张`, `棉条 ${tampons} 支`].filter((text, index) => index === 0 ? pads : tampons).join(' · ');
}
function cleanTimes(values) { return Array.isArray(values) ? [...new Set(values.filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))].sort() : []; }
function renderUsageTimes() {
  ['pads', 'tampons'].forEach(type => {
    const list = document.querySelector(`#${type}TimeList`);
    list.innerHTML = formUsageTimes[type].map(time => `<button type="button" data-remove-time="${type}" data-time="${time}" aria-label="删除 ${time} 的更换记录">${time}<span>×</span></button>`).join('');
  });
}
function periodRange(key) {
  if (records[key]?.period !== 'yes') return [];
  let start = key, end = key, guard = 0;
  while (records[offsetKey(fromKey(start), -1)]?.period === 'yes' && guard++ < 14) start = offsetKey(fromKey(start), -1);
  guard = 0;
  while (records[offsetKey(fromKey(end), 1)]?.period === 'yes' && guard++ < 14) end = offsetKey(fromKey(end), 1);
  return Array.from({ length: daysBetween(start, end) + 1 }, (_, index) => offsetKey(fromKey(start), index));
}
function cycleMetrics() {
  const periodKeys = Object.keys(records).filter(key => records[key]?.period === 'yes').sort();
  const starts = periodKeys.filter(key => records[offsetKey(fromKey(key), -1)]?.period !== 'yes');
  const intervalDetails = starts.slice(1).map((key, index) => ({ start: starts[index], end: key, days: daysBetween(starts[index], key) })).filter(item => item.days >= 15 && item.days <= 90);
  const excluded = new Set(settings.excludedCycles || []);
  const includedDetails = intervalDetails.filter(item => !excluded.has(item.end));
  const intervals = intervalDetails.map(item => item.days);
  const includedIntervals = includedDetails.map(item => item.days);
  const periodRuns = starts.map(start => {
    let length = 0, cursor = start;
    while (records[cursor]?.period === 'yes' && length < 15) { length++; cursor = offsetKey(fromKey(cursor), 1); }
    return length;
  }).filter(Boolean);
  const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const sorted = [...includedIntervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length ? (sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)) : 0;
  return { starts, intervals, includedIntervals, intervalDetails, periodRuns, averageCycle: average(includedIntervals) || settings.cycleLength, typicalCycle: median || settings.cycleLength, averagePeriod: average(periodRuns) || settings.periodLength };
}

function openCycleSettings() {
  const metrics = cycleMetrics();
  cycleSettingsForm.elements.lastPeriodStart.value = settings.lastPeriodStart;
  cycleSettingsForm.elements.cycleLength.value = settings.cycleLength;
  cycleSettingsForm.elements.periodLength.value = settings.periodLength;
  const excluded = new Set(settings.excludedCycles || []);
  document.querySelector('#cycleIntervalList').innerHTML = metrics.intervalDetails.length ? metrics.intervalDetails.slice().reverse().map(item => `<label><span><b>${item.days} 天</b><small>${item.start} → ${item.end}</small></span><input type="checkbox" name="includedCycle" value="${item.end}" ${excluded.has(item.end) ? '' : 'checked'}></label>`).join('') : '<p class="empty-state">至少记录两次经期后，这里会显示周期长度。</p>';
  cycleSettingsDialog.showModal();
}
function openReminderSettings() {
  reminderForm.elements.periodReminder.checked = !!settings.periodReminder;
  reminderForm.elements.periodReminderDays.value = settings.periodReminderDays ?? 2;
  reminderForm.elements.recordReminder.checked = !!settings.recordReminder;
  reminderForm.elements.recordReminderTime.value = settings.recordReminderTime || '20:00';
  const hint = document.querySelector('#notificationHint');
  hint.textContent = !('Notification' in window) ? '当前浏览器不支持系统通知。' : Notification.permission === 'denied' ? '系统通知已被关闭，请在手机设置中重新允许。' : '首次开启提醒时，系统会询问是否允许通知。';
  reminderDialog.showModal();
}

function syncCycleSettingsFromHistory() {
  if (settings.cycleManual) return;
  if (!Object.values(records).some(record => String(record?.importedFrom || '').startsWith('Apple Health'))) return;
  const metrics = cycleMetrics();
  if (metrics.intervals.length >= 2) settings.cycleLength = metrics.typicalCycle;
  if (metrics.periodRuns.length) settings.periodLength = metrics.averagePeriod;
  persist();
}
const pages = { today, calendar, trends, profile };

function render(page = activePage) {
  activePage = page;
  document.body.classList.toggle('large-text', Boolean(settings.largeText));
  screen.innerHTML = pages[page]();
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));
  screen.scrollTop = 0;
  if (page === 'today') requestAnimationFrame(() => {
    const rail = screen.querySelector('.week');
    const current = rail?.querySelector('[data-today="true"]');
    if (rail && current) rail.scrollLeft = current.offsetLeft - rail.clientWidth / 2 + current.clientWidth / 2;
  });
}

function openRecord(dateKey, targets) {
  selectedDate = dateKey || toKey(todayDate);
  recordTargets = targets?.length ? [...targets].sort() : [selectedDate];
  const isBatch = recordTargets.length > 1;
  recordApplyMode = isBatch ? 'batch' : 'single';
  const record = isBatch ? {} : (records[selectedDate] || {});
  form.reset();
  document.querySelector('#recordTitle').textContent = isBatch ? `批量记录 ${recordTargets.length} 天` : '记录这一天';
  document.querySelector('#recordDate').textContent = isBatch ? `${cnDate(fromKey(recordTargets[0]))} 至 ${cnDate(fromKey(recordTargets.at(-1)))}` : cnDate(fromKey(selectedDate));
  const selectedPhase = phaseInfo(selectedDate);
  document.querySelector('#recordCycleDay').textContent = isBatch ? '所选日期将按各自经期分段计算' : selectedPhase.actual ? `实际经期第 ${selectedPhase.day} 天` : `预计${selectedPhase.name} · 周期第 ${selectedPhase.day} 天`;
  form.elements.period.value = record.period || 'no';
  if (record.flow) form.elements.flow.value = record.flow;
  form.elements.pads.value = safeCount(record.pads);
  form.elements.tampons.value = safeCount(record.tampons);
  formUsageTimes = { pads: cleanTimes(record.padTimes), tampons: cleanTimes(record.tamponTimes) };
  renderUsageTimes();
  [...form.querySelectorAll('input[name="symptoms"]')].forEach(input => input.checked = (record.symptoms || []).includes(input.value));
  if (record.mood) form.elements.mood.value = record.mood;
  form.elements.note.value = record.note || '';
  const gapToToday = daysBetween(selectedDate, toKey(todayDate));
  const continueButton = document.querySelector('#continueToToday');
  continueButton.hidden = isBatch || gapToToday < 1 || gapToToday > 13;
  document.querySelector('#deleteRecord').hidden = isBatch || !records[selectedDate];
  document.querySelector('#deletePeriod').hidden = isBatch || record.period !== 'yes';
  dialog.showModal();
}

function updateLastPeriodStart(targets) {
  if (!targets.some(key => key <= toKey(todayDate) && records[key]?.period === 'yes')) return;
  const starts = periodStarts().filter(key => key <= toKey(todayDate));
  if (starts.length) settings.lastPeriodStart = starts.at(-1);
}

function saveRecord() {
  const data = new FormData(form);
  const payload = {
    period: data.get('period') || 'no', flow: data.get('flow') || '', pads: safeCount(data.get('pads')), tampons: safeCount(data.get('tampons')), padTimes: cleanTimes(formUsageTimes.pads), tamponTimes: cleanTimes(formUsageTimes.tampons),
    symptoms: data.getAll('symptoms'), mood: data.get('mood') || '',
    note: String(data.get('note') || '').trim(), updatedAt: new Date().toISOString()
  };
  recordTargets.forEach(key => {
    if (recordApplyMode === 'continuous') {
      const existing = records[key] || {};
      records[key] = { ...existing, period: 'yes', flow: payload.flow || existing.flow || '', pads: safeCount(existing.pads), tampons: safeCount(existing.tampons), padTimes: cleanTimes(existing.padTimes), tamponTimes: cleanTimes(existing.tamponTimes), symptoms: existing.symptoms || [], mood: existing.mood || '', note: existing.note || '', updatedAt: new Date().toISOString() };
    } else records[key] = { ...payload, symptoms: [...payload.symptoms] };
  });
  updateLastPeriodStart(recordTargets);
  const savedCount = recordTargets.length;
  persist();
  if (savedCount > 1) { batchMode = false; batchDates = []; }
  render();
  showToast(savedCount > 1 ? `已保存 ${savedCount} 天记录` : '记录已安全保存在本机');
}

function quickPeriod(value) {
  if (value === 'no') { noPeriodDialog.showModal(); return; }
  quickFlowDialog.showModal();
}

function commitQuickPeriod(value, flow = '') {
  const key = toKey(todayDate);
  records[key] = { ...(records[key] || {}), period: value, flow: flow || records[key]?.flow || '', pads: safeCount(records[key]?.pads), tampons: safeCount(records[key]?.tampons), padTimes: cleanTimes(records[key]?.padTimes), tamponTimes: cleanTimes(records[key]?.tamponTimes), symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', updatedAt: new Date().toISOString() };
  if (value === 'yes') updateLastPeriodStart([key]);
  persist();
  render('today');
  showToast(value === 'yes' ? '已记录：今天来了' : '已记录：今天没有来');
}

function exportData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings, records }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `知期备份-${toKey(todayDate)}.json`; link.click(); URL.revokeObjectURL(link.href);
  showToast('备份文件已导出');
}

function downloadText(content, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}

function markdownReport() {
  const entries = Object.entries(records).sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    '# 知期 · 经期健康记录', '',
    `导出日期：${cnDate(todayDate)}`, '',
    `- 平均周期：${settings.cycleLength} 天`,
    `- 平均经期：${settings.periodLength} 天`,
    `- 记录总数：${entries.length} 天`, '',
    '## 每日记录', '',
    '| 日期 | 经期 | 经量 | 月经巾 | 棉条 | 症状 | 心情 | 备注 |',
    '| --- | --- | --- | ---: | ---: | --- | --- | --- |'
  ];
  entries.forEach(([key, record]) => lines.push(`| ${key} | ${record.period === 'yes' ? '是' : '否'} | ${flowName(record.flow)} | ${safeCount(record.pads)} 张 | ${safeCount(record.tampons)} 支 | ${(record.symptoms || []).join('、') || '-'} | ${record.mood || '-'} | ${(record.note || '-').replace(/\|/g, '｜').replace(/\n/g, ' ')} |`));
  lines.push('', '> 阶段和日期预测仅供日常健康记录参考，不能用于诊断。');
  return lines.join('\n');
}

function printReport() {
  const entries = Object.entries(records).sort(([a], [b]) => a.localeCompare(b));
  const rows = entries.map(([key, record]) => `<tr><td>${key}</td><td>${record.period === 'yes' ? '是' : '否'}</td><td>${flowName(record.flow)}</td><td>${safeCount(record.pads)} 张</td><td>${safeCount(record.tampons)} 支</td><td>${(record.symptoms || []).join('、') || '-'}</td><td>${record.mood || '-'}</td></tr>`).join('');
  const popup = window.open('', '_blank');
  if (!popup) { showToast('请允许打开打印页面'); return; }
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>知期健康记录</title><style>body{font-family:system-ui,"Microsoft YaHei";color:#392b4f;margin:32px}h1{color:#7657b8}p{color:#766d82}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd5e8;padding:8px;text-align:left}th{background:#f3eefb}.note{margin-top:22px;font-size:11px}@media print{body{margin:15mm}}</style></head><body><h1>知期 · 经期健康记录</h1><p>导出日期：${cnDate(todayDate)}　平均周期：${settings.cycleLength} 天　记录：${entries.length} 天</p><table><thead><tr><th>日期</th><th>经期</th><th>经量</th><th>月经巾</th><th>棉条</th><th>症状</th><th>心情</th></tr></thead><tbody>${rows || '<tr><td colspan="7">暂无记录</td></tr>'}</tbody></table><p class="note">阶段和日期预测仅供日常健康记录参考，不能用于诊断。</p><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}

function appleFlow(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('heavy') || text === '4') return 'heavy';
  if (text.includes('medium') || text === '3') return 'medium';
  if (text.includes('light') || text === '2') return 'light';
  return '';
}

function parseAppleHealthXml(text) {
  const documentXml = new DOMParser().parseFromString(text, 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('XML 文件无法读取');
  const samples = [...documentXml.querySelectorAll('Record[type="HKCategoryTypeIdentifierMenstrualFlow"]')];
  const imported = {};
  samples.forEach(sample => {
    const start = String(sample.getAttribute('startDate') || '').slice(0, 10);
    const end = String(sample.getAttribute('endDate') || start).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return;
    const span = Math.max(0, Math.min(13, daysBetween(start, /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : start)));
    for (let i = 0; i <= span; i++) {
      const key = offsetKey(fromKey(start), i);
      imported[key] = { ...(records[key] || {}), period: 'yes', flow: appleFlow(sample.getAttribute('value')), pads: safeCount(records[key]?.pads), tampons: safeCount(records[key]?.tampons), symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', importedFrom: 'Apple Health', updatedAt: new Date().toISOString() };
    }
  });
  if (!Object.keys(imported).length) throw new Error('未识别到苹果健康中的经期记录');
  return { records: imported, source: '苹果健康 XML' };
}

function normalizeAppleText(text) {
  return String(text || '').normalize('NFKC').replace(/[–—]/g, '至').split(/\r?\n/).map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

function applePdfRecord(key) {
  return { ...(records[key] || {}), period: 'yes', flow: records[key]?.flow || '', pads: safeCount(records[key]?.pads), tampons: safeCount(records[key]?.tampons), symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', importedFrom: 'Apple Health PDF', updatedAt: new Date().toISOString() };
}

async function parseAppleHealthPdf(file) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF 解析组件未加载，请确认 pdf.min.js 与 index.html 在同一文件夹');
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.min.js');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdf.numPages < 2) throw new Error('这不是苹果健康的经期历史 PDF');
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= Math.min(2, pdf.numPages); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = '';
    content.items.forEach(item => { pageText += `${item.str}${item.hasEOL ? '\n' : ' '}`; });
    pageTexts.push(normalizeAppleText(pageText));
  }
  const summaryText = pageTexts.join('\n');
  if (!summaryText.includes('经期摘要') && !summaryText.includes('经期历史')) throw new Error('未找到苹果健康经期摘要');
  const cycleMatch = summaryText.match(/一般周[^\n]*?(\d+)\s*天/);
  const periodMatch = summaryText.match(/一般月经[^\n]*?(\d+)\s*天/);
  const tableMarker = summaryText.indexOf('年份');
  const history = tableMarker >= 0 ? summaryText.slice(tableMarker) : summaryText;
  const uniqueStarts = [];
  let currentYear = todayDate.getFullYear();
  history.split('\n').forEach((line, index) => {
    const explicit = line.match(/^(20\d{2})\s*年\s*(?:开始时间\D*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    const implicit = line.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    let year, month, day;
    if (explicit) { year = Number(explicit[1]); currentYear = year; month = Number(explicit[2]); day = Number(explicit[3]); }
    else if (implicit) { year = currentYear; month = Number(implicit[1]); day = Number(implicit[2]); }
    else return;
    const lengths = [...line.matchAll(/(\d{1,2})\s*天/g)].map(match => Number(match[1]));
    const menstrualLength = Math.max(1, Math.min(10, lengths.at(-1) || Number(periodMatch?.[1]) || 5));
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!uniqueStarts.some(entry => entry.key === key)) uniqueStarts.push({ key, index, menstrualLength });
  });
  const imported = {};
  uniqueStarts.forEach(item => {
    for (let offset = 0; offset < item.menstrualLength; offset++) {
      const key = offsetKey(fromKey(item.key), offset);
      imported[key] = applePdfRecord(key);
    }
  });
  if (!Object.keys(imported).length) throw new Error('未识别到 PDF 中的经期日期');
  return { records: imported, settings: { cycleLength: Number(cycleMatch?.[1]) || settings.cycleLength, periodLength: Number(periodMatch?.[1]) || settings.periodLength }, source: `苹果健康 PDF · ${uniqueStarts.length} 次经期` };
}

function parseJsonBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data.records !== 'object' || Array.isArray(data.records)) throw new Error('不是有效的知期备份');
  const clean = {};
  Object.entries(data.records).forEach(([key, record]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !record || typeof record !== 'object') return;
    clean[key] = { ...record, pads: safeCount(record.pads), tampons: safeCount(record.tampons), symptoms: Array.isArray(record.symptoms) ? record.symptoms : [] };
  });
  return { records: clean, settings: data.settings, source: '知期 JSON 备份' };
}

async function prepareImport(file) {
  try {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.pdf')) pendingImport = await parseAppleHealthPdf(file);
    else {
      const text = await file.text();
      pendingImport = lowerName.endsWith('.xml') ? parseAppleHealthXml(text) : parseJsonBackup(text);
    }
    const keys = Object.keys(pendingImport.records).sort();
    if (!keys.length) throw new Error('文件中没有可导入的记录');
    const displayName = lowerName.endsWith('.pdf') ? '苹果健康经期历史 PDF' : file.name;
    importFileName.textContent = `${displayName} · ${pendingImport.source}`;
    const added = keys.filter(key => !records[key]).length;
    const existing = keys.filter(key => records[key]);
    const conflicts = existing.filter(key => JSON.stringify(records[key]) !== JSON.stringify(pendingImport.records[key])).length;
    pendingImport.stats = { added, overwritten: existing.length - conflicts, conflicts };
    importSummary.innerHTML = `<div class="import-counts"><span><strong>${added}</strong><small>新增</small></span><span><strong>${existing.length - conflicts}</strong><small>覆盖</small></span><span><strong>${conflicts}</strong><small>冲突</small></span></div><p>共 ${keys.length} 天 · ${keys[0]} 至 ${keys.at(-1)}</p>`;
    importDialog.showModal();
  } catch (error) {
    pendingImport = null;
    alert(`无法导入：${error.message}`);
  } finally { importFile.value = ''; }
}

function applyImport() {
  if (!pendingImport) return;
  saveDurableSnapshot('before-import', { records, settings, savedAt: new Date().toISOString(), version: 2 });
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
  if (mode === 'overwrite') records = { ...records, ...pendingImport.records };
  else Object.entries(pendingImport.records).forEach(([key, incoming]) => { records[key] = records[key] ? { ...incoming, ...records[key] } : incoming; });
  if (pendingImport.settings && typeof pendingImport.settings === 'object') settings = { ...settings, ...pendingImport.settings };
  const periodKeys = Object.keys(pendingImport.records).filter(key => pendingImport.records[key]?.period === 'yes' && key <= toKey(todayDate)).sort();
  if (periodKeys.length) settings.lastPeriodStart = periodKeys.at(-1);
  const importedMetrics = cycleMetrics();
  if (!settings.cycleManual && importedMetrics.includedIntervals.length >= 2) settings.cycleLength = importedMetrics.typicalCycle;
  if (!settings.cycleManual && importedMetrics.periodRuns.length) settings.periodLength = importedMetrics.averagePeriod;
  const count = Object.keys(pendingImport.records).length;
  persist(); pendingImport = null; importDialog.close(); render('profile'); showToast(`已${mode === 'overwrite' ? '覆盖' : '合并'}导入 ${count} 天记录`);
}

async function restoreSnapshot(id, label) {
  const snapshot = await readDurableSnapshot(id);
  if (!snapshot?.records || !confirm(`确定${label}吗？当前未备份的修改会被替换。`)) return;
  records = snapshot.records; settings = { ...defaultSettings(), ...(snapshot.settings || {}) };
  persist(); render('profile'); showToast(`${label}完成`);
}

screen.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  const action = button.dataset.action, date = button.dataset.date;
  if (button.classList.contains('day') && date) return openRecord(date);
  if (date && !action) {
    if (batchMode) {
      batchDates = batchDates.includes(date) ? batchDates.filter(key => key !== date) : [...batchDates, date].sort();
    } else selectedDate = date;
    render('calendar'); return;
  }
  if (action === 'record') return openRecord(date || selectedDate);
  if (action === 'quick-period') return quickPeriod(button.dataset.value);
  if (button.dataset.trendLimit) { trendLimit = Number(button.dataset.trendLimit); render('trends'); return; }
  if (action === 'toggle-batch') { batchMode = !batchMode; batchDates = []; render('calendar'); return; }
  if (action === 'batch-record' && batchDates.length) return openRecord(batchDates[0], batchDates);
  if (action === 'trends') return render('trends');
  if (action === 'prev-month' || action === 'next-month') { calendarCursor.setMonth(calendarCursor.getMonth() + (action === 'next-month' ? 1 : -1)); render('calendar'); return; }
  if (action === 'toggle-reminder') { settings.reminder = !settings.reminder; persist(); render('profile'); showToast(settings.reminder ? '提醒已开启' : '提醒已关闭'); return; }
  if (action === 'toggle-large-text') { settings.largeText = !settings.largeText; persist(); render('profile'); showToast(settings.largeText ? '大字号已开启' : '已恢复标准字号'); return; }
  if (action === 'import') return importFile.click();
  if (action === 'cycle-settings') return openCycleSettings();
  if (action === 'reminder-settings') return openReminderSettings();
  if (action === 'install-app') {
    if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render('profile'); }); }
    else installHelpDialog.showModal();
    return;
  }
  if (action === 'offline-info') return showToast(navigator.onLine ? '离线功能已准备，可从浏览器菜单安装' : '当前可继续离线记录');
  if (action === 'restore-snapshot') return restoreSnapshot('latest', '恢复自动快照');
  if (action === 'undo-import') return restoreSnapshot('before-import', '撤销最近一次导入');
  if (action === 'export-json') { exportData(); showToast('JSON 完整备份已下载'); return; }
  if (action === 'export') { exportDialog.showModal(); return; }
  if (action === 'reset' && confirm('确定清除当前设备上的所有记录吗？')) { records = {}; settings = defaultSettings(); batchMode = false; batchDates = []; persist(); render('profile'); showToast('记录与周期设置已恢复'); return; }
  if (action === 'about') return alert('阶段预测基于最近一次经期开始日与平均周期估算。实际排卵日和各阶段长度会波动，不能用于诊断或替代专业医疗建议。');
  if (action === 'privacy') return showToast('本地隐私模式已开启');
});

tabs.forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.page !== 'calendar') { batchMode = false; batchDates = []; } render(tab.dataset.page); }));
dialog.addEventListener('close', () => { if (dialog.returnValue === 'save') saveRecord(); });
form.addEventListener('click', event => {
  const counterButton = event.target.closest('[data-counter]');
  if (counterButton) {
    const input = form.elements[counterButton.dataset.counter];
    input.value = safeCount(safeCount(input.value) + Number(counterButton.dataset.step));
    return;
  }
  const addTimeButton = event.target.closest('[data-add-time]');
  if (addTimeButton) {
    const type = addTimeButton.dataset.addTime;
    const input = document.querySelector(`#${type}TimeInput`);
    const now = new Date();
    const time = input.value || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    formUsageTimes[type] = cleanTimes([...formUsageTimes[type], time]);
    form.elements[type].value = Math.max(safeCount(form.elements[type].value), formUsageTimes[type].length);
    input.value = ''; renderUsageTimes(); return;
  }
  const removeTimeButton = event.target.closest('[data-remove-time]');
  if (removeTimeButton) {
    const type = removeTimeButton.dataset.removeTime;
    formUsageTimes[type] = formUsageTimes[type].filter(time => time !== removeTimeButton.dataset.time);
    renderUsageTimes();
  }
});
document.querySelector('#continueToToday').addEventListener('click', () => {
  const length = daysBetween(selectedDate, toKey(todayDate)) + 1;
  if (length < 2 || length > 14) return;
  recordTargets = Array.from({ length }, (_, index) => offsetKey(fromKey(selectedDate), index));
  recordApplyMode = 'continuous';
  form.elements.period.value = 'yes';
  document.querySelector('#recordTitle').textContent = `连续记录 ${length} 天`;
  document.querySelector('#recordCycleDay').textContent = '从所选日期连续记录到今天';
  document.querySelector('#continueToToday').hidden = true;
});
document.querySelector('#deleteRecord').addEventListener('click', () => {
  if (!confirm(`确定删除 ${cnDate(fromKey(selectedDate))} 的全部记录吗？`)) return;
  delete records[selectedDate]; persist(); dialog.close(); render(); showToast('这一天的记录已删除');
});
document.querySelector('#deletePeriod').addEventListener('click', () => {
  const range = periodRange(selectedDate); if (!range.length || !confirm(`确定删除这段 ${range.length} 天的经期标记吗？其他症状和备注会保留。`)) return;
  range.forEach(key => { if (records[key]) { records[key].period = 'no'; records[key].flow = ''; records[key].updatedAt = new Date().toISOString(); } });
  persist(); dialog.close(); render(); showToast('整段经期标记已删除');
});
importFile.addEventListener('change', () => { const file = importFile.files?.[0]; if (file) prepareImport(file); });
document.querySelector('#closeImport').addEventListener('click', () => { pendingImport = null; importDialog.close(); });
document.querySelector('#confirmImport').addEventListener('click', applyImport);
document.querySelector('#closeCycleSettings').addEventListener('click', () => cycleSettingsDialog.close());
cycleSettingsForm.addEventListener('submit', event => {
  event.preventDefault();
  const previousStart = settings.lastPeriodStart;
  const nextStart = cycleSettingsForm.elements.lastPeriodStart.value;
  settings.cycleLength = Math.max(15, Math.min(90, Number(cycleSettingsForm.elements.cycleLength.value) || 28));
  settings.periodLength = Math.max(1, Math.min(15, Number(cycleSettingsForm.elements.periodLength.value) || 5));
  settings.cycleManual = true;
  settings.lastPeriodStart = nextStart;
  const included = new Set([...cycleSettingsForm.querySelectorAll('input[name="includedCycle"]:checked')].map(input => input.value));
  settings.excludedCycles = cycleMetrics().intervalDetails.map(item => item.end).filter(end => !included.has(end));
  if (nextStart !== previousStart) {
    const oldRange = periodRange(previousStart);
    oldRange.forEach(key => { if (records[key]) { records[key].period = 'no'; records[key].flow = ''; } });
    const length = oldRange.length || settings.periodLength;
    Array.from({ length }, (_, index) => offsetKey(fromKey(nextStart), index)).forEach(key => { records[key] = { ...(records[key] || {}), period: 'yes', flow: records[key]?.flow || '', symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', updatedAt: new Date().toISOString() }; });
  }
  persist(); cycleSettingsDialog.close(); render('profile'); showToast('周期设置已保存');
});
document.querySelector('#closeReminderSettings').addEventListener('click', () => reminderDialog.close());
reminderForm.addEventListener('submit', async event => {
  event.preventDefault();
  const wantsNotifications = reminderForm.elements.periodReminder.checked || reminderForm.elements.recordReminder.checked;
  if (wantsNotifications && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  settings.periodReminder = reminderForm.elements.periodReminder.checked;
  settings.periodReminderDays = Math.max(0, Math.min(7, Number(reminderForm.elements.periodReminderDays.value) || 0));
  settings.recordReminder = reminderForm.elements.recordReminder.checked;
  settings.recordReminderTime = reminderForm.elements.recordReminderTime.value || '20:00';
  persist(); reminderDialog.close(); render('profile'); showToast('提醒设置已保存'); checkReminders();
});
document.querySelector('#closeExport').addEventListener('click', () => exportDialog.close());
exportDialog.addEventListener('click', event => {
  const button = event.target.closest('[data-export-format]'); if (!button) return;
  const format = button.dataset.exportFormat;
  exportDialog.close();
  if (format === 'markdown') { downloadText(markdownReport(), `知期健康记录-${toKey(todayDate)}.md`, 'text/markdown;charset=utf-8'); showToast('Markdown 报告已导出'); }
  if (format === 'pdf') printReport();
  if (format === 'json') exportData();
});
cancelNoPeriod.addEventListener('click', () => noPeriodDialog.close());
confirmNoPeriod.addEventListener('click', () => { noPeriodDialog.close(); commitQuickPeriod('no'); });
quickFlowDialog.addEventListener('click', event => {
  const button = event.target.closest('[data-quick-flow]'); if (!button) return;
  quickFlowDialog.close(); commitQuickPeriod('yes', button.dataset.quickFlow);
});
document.querySelector('#cancelQuickFlow').addEventListener('click', () => quickFlowDialog.close());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; if (activePage === 'profile') render('profile'); });
window.addEventListener('online', () => { pwaRegistration?.update().catch(() => {}); if (activePage === 'profile') render('profile'); showToast('网络已恢复，正在检查新版本'); });
window.addEventListener('offline', () => { if (activePage === 'profile') render('profile'); showToast('已进入离线模式'); });

async function notify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker?.ready;
  if (registration) registration.showNotification(title, { body, tag, icon: 'icons/app-icon-192.png', badge: 'icons/app-icon-192.png' });
  else new Notification(title, { body, tag, icon: 'icons/app-icon-192.png' });
}
function checkReminders() {
  const now = new Date();
  const dayKey = toKey(now);
  const reminderLog = load('zhiqi-reminder-log-v1', {});
  if (settings.periodReminder && relativeDays(nextPeriodDate()) === settings.periodReminderDays && reminderLog.period !== dayKey) {
    notify('知期提醒', '预计经期临近，可以提前准备月经用品。', 'period-reminder'); reminderLog.period = dayKey;
  }
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (settings.recordReminder && currentTime === settings.recordReminderTime && reminderLog.record !== dayKey) {
    notify('知期提醒', '今天的记录还可以再补充一下。', 'record-reminder'); reminderLog.record = dayKey;
  }
  localStorage.setItem('zhiqi-reminder-log-v1', JSON.stringify(reminderLog));
}
async function registerPwa() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  pwaRegistration = registration;
  if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage('SKIP_WAITING');
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
  await registration.update().catch(() => {});
}
document.querySelector('#updateLater').addEventListener('click', () => updateDialog.close());
document.querySelector('#updateNow').addEventListener('click', () => { waitingWorker?.postMessage('SKIP_WAITING'); updateDialog.close(); });
document.querySelector('#closeInstallHelp').addEventListener('click', () => installHelpDialog.close());
document.querySelector('#closeInstallHelpPrimary').addEventListener('click', () => installHelpDialog.close());
async function bootstrap() {
  const recovered = await recoverIfNeeded();
  syncCycleSettingsFromHistory();
  render('today');
  registerPwa().catch(() => {});
  checkReminders();
  setInterval(checkReminders, 60000);
  if (recovered) showToast('已从自动快照恢复记录');
}
bootstrap();
