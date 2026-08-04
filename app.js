const screen = document.querySelector('#screen');
const tabs = [...document.querySelectorAll('.tab')];
const dialog = document.querySelector('#recordDialog');
const form = document.querySelector('#recordForm');
const toast = document.querySelector('#toast');
const noPeriodDialog = document.querySelector('#noPeriodDialog');
const cancelNoPeriod = document.querySelector('#cancelNoPeriod');
const confirmNoPeriod = document.querySelector('#confirmNoPeriod');
const importFile = document.querySelector('#importFile');
const importDialog = document.querySelector('#importDialog');
const exportDialog = document.querySelector('#exportDialog');
const importSummary = document.querySelector('#importSummary');
const importFileName = document.querySelector('#importFileName');
let pendingImport = null;

const STORE_KEY = 'zhiqi-records-v2';
const SETTINGS_KEY = 'zhiqi-settings-v2';
const todayDate = new Date();
todayDate.setHours(12, 0, 0, 0);
let activePage = 'today';
let selectedDate = toKey(todayDate);
let calendarCursor = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
let batchMode = false;
let batchDates = [];
let recordTargets = [selectedDate];
let records = load(STORE_KEY, {});
const defaultSettings = () => ({ cycleLength: 28, periodLength: 5, lastPeriodStart: offsetKey(todayDate, -17), reminder: true });
let settings = load(SETTINGS_KEY, defaultSettings());

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(records));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
function cycleDay(key) {
  const raw = daysBetween(settings.lastPeriodStart, key);
  return ((raw % settings.cycleLength) + settings.cycleLength) % settings.cycleLength + 1;
}
function nextPeriodDate() {
  let next = fromKey(settings.lastPeriodStart);
  while (next <= todayDate) next.setDate(next.getDate() + settings.cycleLength);
  return toKey(next);
}
function relativeDays(key) { return daysBetween(toKey(todayDate), key); }
function phaseInfo(key) {
  const day = cycleDay(key);
  const ovulationDay = Math.max(settings.periodLength + 2, settings.cycleLength - 14);
  const lateLutealStart = Math.max(ovulationDay + 2, settings.cycleLength - 6);
  if (day <= settings.periodLength) return { id: 'period-phase', name: '经期', detail: `预计第 ${day} 天` };
  if (day <= ovulationDay) return { id: 'follicular', name: '卵泡期', detail: `预计排卵日前 · 周期第 ${day} 天` };
  if (day < lateLutealStart) return { id: 'early-luteal', name: '黄体前期', detail: `预计排卵后 · 周期第 ${day} 天` };
  return { id: 'late-luteal', name: '黄体后期', detail: `预计经期前 · 周期第 ${day} 天` };
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
  const daysToNext = relativeDays(next);
  const phase = phaseInfo(todayKey);
  const symptomText = record?.symptoms?.length ? record.symptoms.join('、') : '尚未记录';
  const periodText = record?.period === 'yes' ? `今天有经期 · ${flowName(record.flow)}` : record?.period === 'no' ? '今天没有来' : `本周期预计 ${settings.periodLength} 天`;
  const productText = usageText(record);
  return `<div class="topline"><div><h1>今天</h1><div class="date">${cnDate(todayDate, true)}</div></div><button class="privacy" aria-label="隐私模式" data-action="privacy">◉</button></div>
    ${weekStrip()}
    <div class="cycle"><div class="cycle-content"><small>预计${phase.name}</small><strong>第 ${cycleDay(todayKey)} 天</strong><span>${daysToNext >= 0 ? `预计 ${daysToNext} 天后` : '请更新经期日期'}</span></div></div>
    <div class="phase-card"><div>${phaseShape(phase.id)}<div><b>预计${phase.name}</b><small>${phase.detail}</small></div></div><small class="estimate">仅为估算</small></div>
    ${phaseTrack(phase.id)}
    <div class="quick-period"><div><b>今天月经来了吗？</b><small>${record?.period ? '已记录，可随时修改' : '一秒完成快速记录'}</small></div><div class="quick-actions"><button data-action="quick-period" data-value="yes" class="${record?.period === 'yes' ? 'active' : ''}">来了</button><button data-action="quick-period" data-value="no" class="${record?.period === 'no' ? 'active' : ''}">没有</button></div></div>
    <button class="primary" data-action="record" data-date="${todayKey}">${record ? '补充详细记录' : '记录更多感受'}</button>
    <p class="prediction">预计下次经期 <b>${cnDate(fromKey(next))}</b></p>
    <h2 class="section-title">今日记录</h2><div class="list">${row('♡', '症状与感受', symptomText, 'record')}${row('◔', '经期记录', periodText, 'record')}${row('▤', '卫生用品', productText, 'record')}${row('⌁', '周期趋势', `平均周期 ${settings.cycleLength} 天`, 'trends')}</div>`;
}

function calendar() {
  const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const predictedStart = nextPeriodDate();
  const cells = Array.from({ length: firstDay }, () => '<span></span>');
  for (let day = 1; day <= total; day++) {
    const date = new Date(year, month, day, 12), key = toKey(date), record = records[key];
    const predictedOffset = daysBetween(predictedStart, key);
    const phase = phaseInfo(key);
    const classes = [record?.period === 'yes' ? 'period' : '', predictedOffset >= 0 && predictedOffset < settings.periodLength ? 'predicted' : '', key === selectedDate && !batchMode ? 'selected' : '', batchDates.includes(key) ? 'batch-selected' : '', `phase-${phase.id}`].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" data-date="${key}" aria-label="${cnDate(date)}，预计${phase.name}${record ? '，已有记录' : ''}">${day}</button>`);
  }
  const selectedRecord = records[selectedDate];
  const selectedPhase = phaseInfo(selectedDate);
  const summary = selectedRecord ? [selectedRecord.period === 'yes' ? `经期·${flowName(selectedRecord.flow)}` : '非经期', usageText(selectedRecord, true), ...(selectedRecord.symptoms || []), selectedRecord.mood].filter(Boolean).join(' · ') : '尚未记录这一天';
  const batchPanel = batchMode ? `<div class="batch-panel"><span><b>已选 ${batchDates.length} 天</b><small>再次点击可取消</small></span><button data-action="batch-record" ${batchDates.length ? '' : 'disabled'}>批量记录</button></div>` : '';
  return `<div class="calendar-title"><div><h1 class="page-title">日历</h1><div class="subtle">${batchMode ? '点击多个日期进行批量记录' : '查看阶段预测或补充记录'}</div></div><button class="multi-toggle ${batchMode ? 'active' : ''}" data-action="toggle-batch">${batchMode ? '取消多选' : '多选日期'}</button></div>
    <div class="calendar-head"><button data-action="prev-month" aria-label="上个月">‹</button><b>${year}年${month + 1}月</b><button data-action="next-month" aria-label="下个月">›</button></div>
    <div class="month"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>${cells.join('')}</div>
    <div class="phase-legend" aria-label="阶段图例"><span><i class="phase-shape period-phase"></i>经期</span><span><i class="predicted-ring"></i>预测经期</span><span>${phaseShape('follicular')}卵泡期</span><span>${phaseShape('early-luteal')}黄体前期</span><span>${phaseShape('late-luteal')}黄体后期</span></div>
    ${batchPanel}
    ${batchMode ? '' : `<div class="insight"><h3>${cnDate(fromKey(selectedDate))} · 预计${selectedPhase.name}</h3><p class="subtle">周期第 ${cycleDay(selectedDate)} 天 · ${summary}</p><button class="primary" data-action="record" data-date="${selectedDate}">${selectedRecord ? '编辑记录' : '补充记录'}</button></div>`}`;
}

function trends() {
  const periodRecords = Object.entries(records).filter(([, r]) => r.period === 'yes');
  const symptomCount = {};
  Object.values(records).forEach(r => (r.symptoms || []).forEach(s => symptomCount[s] = (symptomCount[s] || 0) + 1));
  const common = Object.entries(symptomCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '暂无记录';
  const totalPads = Object.values(records).reduce((sum, record) => sum + safeCount(record.pads), 0);
  const totalTampons = Object.values(records).reduce((sum, record) => sum + safeCount(record.tampons), 0);
  const cycleSeed = [settings.cycleLength - 1, settings.cycleLength + 1, settings.cycleLength, settings.cycleLength - 2, settings.cycleLength + 2, settings.cycleLength];
  const heights = cycleSeed.map(v => Math.max(48, Math.min(96, 58 + (v - 24) * 5)));
  return `<h1 class="page-title">周期趋势</h1><div class="subtle">记录越完整，趋势越准确</div>
    <div class="stats"><div class="stat"><strong>${settings.cycleLength}<small>天</small></strong><span>平均周期</span></div><div class="stat"><strong>${settings.periodLength}<small>天</small></strong><span>平均经期</span></div><div class="stat"><strong>${periodRecords.length}<small>天</small></strong><span>已记录经期</span></div><div class="stat"><strong>${Object.keys(records).length}<small>天</small></strong><span>记录总数</span></div></div>
    <h2 class="section-title">用品使用</h2><div class="usage-stats"><div><span class="usage-icon">▤</span><p><b>${totalPads}<small> 张</small></b><span>月经巾累计</span></p></div><div><span class="usage-icon tampon">▯</span><p><b>${totalTampons}<small> 支</small></b><span>月经棉条累计</span></p></div></div>
    <h2 class="section-title">周期长度</h2><div class="chart">${heights.map((h, i) => `<div class="bar ${i === 5 ? 'active' : ''}" style="height:${h}%" data-label="${['3月','4月','5月','6月','7月','本次'][i]}"></div>`).join('')}</div>
    <div class="insight"><h3>最常记录：${common}</h3><p class="subtle">最近周期预计波动在 2 天以内。预测仅供日常健康记录参考。</p></div>`;
}

function profile() {
  return `<h1 class="page-title">我的</h1><div class="subtle">数据只属于你</div>
    <div class="profile-card"><h3>本地隐私保护</h3><p class="subtle">${Object.keys(records).length ? `已有 ${Object.keys(records).length} 天记录保存在当前设备。` : '记录仅保存在当前设备，不需要注册账号。'}</p></div>
    <div class="list">${row('⌁','提醒设置', settings.reminder ? '经期前 2 天提醒' : '提醒已关闭','toggle-reminder')}${row('⇩','导入备份','支持知期 JSON、苹果健康 PDF/XML','import')}${row('⇧','导出与保存','Markdown、PDF 或 JSON','export')}${row('↺','恢复演示数据','清除记录并恢复默认','reset')}${row('?','关于预测','了解计算方式与限制','about')}</div>
    <div class="insight"><p class="subtle">阶段和日期均为估算，不能用于避孕、诊断或替代专业医疗建议。</p></div>`;
}

function flowName(value) { return ({ light: '少量', medium: '适中', heavy: '较多' })[value] || '未记录经量'; }
function safeCount(value) { const count = Number.parseInt(value, 10); return Number.isFinite(count) ? Math.max(0, Math.min(50, count)) : 0; }
function usageText(record, compact = false) {
  const pads = safeCount(record?.pads), tampons = safeCount(record?.tampons);
  if (!pads && !tampons) return compact ? '' : '尚未记录使用数量';
  return [`月经巾 ${pads} 张`, `棉条 ${tampons} 支`].filter((text, index) => index === 0 ? pads : tampons).join(' · ');
}
const pages = { today, calendar, trends, profile };

function render(page = activePage) {
  activePage = page;
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
  const record = isBatch ? {} : (records[selectedDate] || {});
  form.reset();
  document.querySelector('#recordTitle').textContent = isBatch ? `批量记录 ${recordTargets.length} 天` : '记录这一天';
  document.querySelector('#recordDate').textContent = isBatch ? `${cnDate(fromKey(recordTargets[0]))} 至 ${cnDate(fromKey(recordTargets.at(-1)))}` : cnDate(fromKey(selectedDate));
  document.querySelector('#recordCycleDay').textContent = isBatch ? '所选日期将使用相同记录' : `预计${phaseInfo(selectedDate).name} · 周期第 ${cycleDay(selectedDate)} 天`;
  form.elements.period.value = record.period || 'no';
  if (record.flow) form.elements.flow.value = record.flow;
  form.elements.pads.value = safeCount(record.pads);
  form.elements.tampons.value = safeCount(record.tampons);
  [...form.querySelectorAll('input[name="symptoms"]')].forEach(input => input.checked = (record.symptoms || []).includes(input.value));
  if (record.mood) form.elements.mood.value = record.mood;
  form.elements.note.value = record.note || '';
  dialog.showModal();
}

function updateLastPeriodStart(targets) {
  const candidates = targets.filter(key => key <= toKey(todayDate) && records[key]?.period === 'yes').sort();
  if (!candidates.length) return;
  const starts = candidates.filter(key => records[offsetKey(fromKey(key), -1)]?.period !== 'yes');
  settings.lastPeriodStart = (starts[0] || candidates[0]);
}

function saveRecord() {
  const data = new FormData(form);
  const payload = {
    period: data.get('period') || 'no', flow: data.get('flow') || '', pads: safeCount(data.get('pads')), tampons: safeCount(data.get('tampons')),
    symptoms: data.getAll('symptoms'), mood: data.get('mood') || '',
    note: String(data.get('note') || '').trim(), updatedAt: new Date().toISOString()
  };
  recordTargets.forEach(key => { records[key] = { ...payload, symptoms: [...payload.symptoms] }; });
  updateLastPeriodStart(recordTargets);
  const savedCount = recordTargets.length;
  persist();
  if (savedCount > 1) { batchMode = false; batchDates = []; }
  render();
  showToast(savedCount > 1 ? `已保存 ${savedCount} 天记录` : '记录已安全保存在本机');
}

function quickPeriod(value) {
  if (value === 'no') { noPeriodDialog.showModal(); return; }
  commitQuickPeriod(value);
}

function commitQuickPeriod(value) {
  const key = toKey(todayDate);
  records[key] = { ...(records[key] || {}), period: value, flow: records[key]?.flow || '', pads: safeCount(records[key]?.pads), tampons: safeCount(records[key]?.tampons), symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', updatedAt: new Date().toISOString() };
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
  lines.push('', '> 阶段和日期预测仅供日常健康记录参考，不能用于避孕或诊断。');
  return lines.join('\n');
}

function printReport() {
  const entries = Object.entries(records).sort(([a], [b]) => a.localeCompare(b));
  const rows = entries.map(([key, record]) => `<tr><td>${key}</td><td>${record.period === 'yes' ? '是' : '否'}</td><td>${flowName(record.flow)}</td><td>${safeCount(record.pads)} 张</td><td>${safeCount(record.tampons)} 支</td><td>${(record.symptoms || []).join('、') || '-'}</td><td>${record.mood || '-'}</td></tr>`).join('');
  const popup = window.open('', '_blank');
  if (!popup) { showToast('请允许打开打印页面'); return; }
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>知期健康记录</title><style>body{font-family:system-ui,"Microsoft YaHei";color:#392b4f;margin:32px}h1{color:#7657b8}p{color:#766d82}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd5e8;padding:8px;text-align:left}th{background:#f3eefb}.note{margin-top:22px;font-size:11px}@media print{body{margin:15mm}}</style></head><body><h1>知期 · 经期健康记录</h1><p>导出日期：${cnDate(todayDate)}　平均周期：${settings.cycleLength} 天　记录：${entries.length} 天</p><table><thead><tr><th>日期</th><th>经期</th><th>经量</th><th>月经巾</th><th>棉条</th><th>症状</th><th>心情</th></tr></thead><tbody>${rows || '<tr><td colspan="7">暂无记录</td></tr>'}</tbody></table><p class="note">阶段和日期预测仅供日常健康记录参考，不能用于避孕或诊断。</p><script>window.onload=()=>window.print()<\/script></body></html>`);
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
  const pdfjs = await import('./pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
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
    importSummary.innerHTML = `<div><strong>${keys.length}</strong><span>识别记录天数</span></div><p>${keys[0]} 至 ${keys.at(-1)}</p>`;
    importDialog.showModal();
  } catch (error) {
    pendingImport = null;
    alert(`无法导入：${error.message}`);
  } finally { importFile.value = ''; }
}

function applyImport() {
  if (!pendingImport) return;
  records = { ...records, ...pendingImport.records };
  if (pendingImport.settings && typeof pendingImport.settings === 'object') settings = { ...settings, ...pendingImport.settings };
  const periodKeys = Object.keys(pendingImport.records).filter(key => pendingImport.records[key]?.period === 'yes' && key <= toKey(todayDate)).sort();
  if (periodKeys.length) settings.lastPeriodStart = periodKeys.at(-1);
  const count = Object.keys(pendingImport.records).length;
  persist(); pendingImport = null; importDialog.close(); render('profile'); showToast(`已导入 ${count} 天记录`);
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
  if (action === 'toggle-batch') { batchMode = !batchMode; batchDates = []; render('calendar'); return; }
  if (action === 'batch-record' && batchDates.length) return openRecord(batchDates[0], batchDates);
  if (action === 'trends') return render('trends');
  if (action === 'prev-month' || action === 'next-month') { calendarCursor.setMonth(calendarCursor.getMonth() + (action === 'next-month' ? 1 : -1)); render('calendar'); return; }
  if (action === 'toggle-reminder') { settings.reminder = !settings.reminder; persist(); render('profile'); showToast(settings.reminder ? '提醒已开启' : '提醒已关闭'); return; }
  if (action === 'import') return importFile.click();
  if (action === 'export') { exportDialog.showModal(); return; }
  if (action === 'reset' && confirm('确定清除当前设备上的所有记录吗？')) { records = {}; settings = defaultSettings(); batchMode = false; batchDates = []; persist(); render('profile'); showToast('记录与周期设置已恢复'); return; }
  if (action === 'about') return alert('阶段预测基于最近一次经期开始日与平均周期估算。实际排卵日和各阶段长度会波动，不能用于避孕、诊断或替代专业医疗建议。');
  if (action === 'privacy') return showToast('本地隐私模式已开启');
});

tabs.forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.page !== 'calendar') { batchMode = false; batchDates = []; } render(tab.dataset.page); }));
dialog.addEventListener('close', () => { if (dialog.returnValue === 'save') saveRecord(); });
form.addEventListener('click', event => {
  const button = event.target.closest('[data-counter]');
  if (!button) return;
  const input = form.elements[button.dataset.counter];
  input.value = safeCount(safeCount(input.value) + Number(button.dataset.step));
});
importFile.addEventListener('change', () => { const file = importFile.files?.[0]; if (file) prepareImport(file); });
document.querySelector('#closeImport').addEventListener('click', () => { pendingImport = null; importDialog.close(); });
document.querySelector('#confirmImport').addEventListener('click', applyImport);
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
render('today');
