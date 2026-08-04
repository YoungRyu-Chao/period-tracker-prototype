const screen = document.querySelector('#screen');
const tabs = [...document.querySelectorAll('.tab')];
const dialog = document.querySelector('#recordDialog');
const form = document.querySelector('#recordForm');
const toast = document.querySelector('#toast');

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
  const mondayOffset = (todayDate.getDay() + 6) % 7;
  return `<div class="week">${Array.from({ length: 7 }, (_, i) => {
    const date = new Date(todayDate); date.setDate(todayDate.getDate() - mondayOffset + i);
    return `<button class="day ${toKey(date) === toKey(todayDate) ? 'current' : ''}" data-date="${toKey(date)}">${'日一二三四五六'[date.getDay()]}<b>${date.getDate()}</b></button>`;
  }).join('')}</div>`;
}

function phaseTrack(active) {
  return `<div class="phase-track" aria-label="预计周期阶段">
    <span class="${active === 'follicular' ? 'active' : ''}"><i></i>卵泡期</span>
    <span class="${active === 'early-luteal' ? 'active' : ''}"><i></i>黄体前期</span>
    <span class="${active === 'late-luteal' ? 'active' : ''}"><i></i>黄体后期</span>
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
  return `<div class="topline"><div><h1>今天</h1><div class="date">${cnDate(todayDate, true)}</div></div><button class="privacy" aria-label="隐私模式" data-action="privacy">◉</button></div>
    ${weekStrip()}
    <div class="cycle"><div class="cycle-content"><small>预计${phase.name}</small><strong>第 ${cycleDay(todayKey)} 天</strong><span>${daysToNext >= 0 ? `预计 ${daysToNext} 天后` : '请更新经期日期'}</span></div></div>
    <div class="phase-card"><div><span class="phase-dot ${phase.id}"></span><div><b>预计${phase.name}</b><small>${phase.detail}</small></div></div><small class="estimate">仅为估算</small></div>
    ${phaseTrack(phase.id)}
    <div class="quick-period"><div><b>今天月经来了吗？</b><small>${record?.period ? '已记录，可随时修改' : '一秒完成快速记录'}</small></div><div class="quick-actions"><button data-action="quick-period" data-value="yes" class="${record?.period === 'yes' ? 'active' : ''}">来了</button><button data-action="quick-period" data-value="no" class="${record?.period === 'no' ? 'active' : ''}">没有</button></div></div>
    <button class="primary" data-action="record" data-date="${todayKey}">${record ? '补充详细记录' : '记录更多感受'}</button>
    <p class="prediction">预计下次经期 <b>${cnDate(fromKey(next))}</b></p>
    <h2 class="section-title">今日记录</h2><div class="list">${row('♡', '症状与感受', symptomText, 'record')}${row('◔', '经期记录', periodText, 'record')}${row('⌁', '周期趋势', `平均周期 ${settings.cycleLength} 天`, 'trends')}</div>`;
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
  const summary = selectedRecord ? [selectedRecord.period === 'yes' ? `经期·${flowName(selectedRecord.flow)}` : '非经期', ...(selectedRecord.symptoms || []), selectedRecord.mood].filter(Boolean).join(' · ') : '尚未记录这一天';
  const batchPanel = batchMode ? `<div class="batch-panel"><span><b>已选 ${batchDates.length} 天</b><small>再次点击可取消</small></span><button data-action="batch-record" ${batchDates.length ? '' : 'disabled'}>批量记录</button></div>` : '';
  return `<div class="calendar-title"><div><h1 class="page-title">日历</h1><div class="subtle">${batchMode ? '点击多个日期进行批量记录' : '查看阶段预测或补充记录'}</div></div><button class="multi-toggle ${batchMode ? 'active' : ''}" data-action="toggle-batch">${batchMode ? '取消多选' : '多选日期'}</button></div>
    <div class="calendar-head"><button data-action="prev-month" aria-label="上个月">‹</button><b>${year}年${month + 1}月</b><button data-action="next-month" aria-label="下个月">›</button></div>
    <div class="month"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>${cells.join('')}</div>
    <div class="legend"><span><i class="dot"></i>已记录经期</span><span><i class="dot predict"></i>预测经期</span><span><i class="dot phase"></i>阶段预测</span></div>
    ${batchPanel}
    ${batchMode ? '' : `<div class="insight"><h3>${cnDate(fromKey(selectedDate))} · 预计${selectedPhase.name}</h3><p class="subtle">周期第 ${cycleDay(selectedDate)} 天 · ${summary}</p><button class="primary" data-action="record" data-date="${selectedDate}">${selectedRecord ? '编辑记录' : '补充记录'}</button></div>`}`;
}

function trends() {
  const periodRecords = Object.entries(records).filter(([, r]) => r.period === 'yes');
  const symptomCount = {};
  Object.values(records).forEach(r => (r.symptoms || []).forEach(s => symptomCount[s] = (symptomCount[s] || 0) + 1));
  const common = Object.entries(symptomCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '暂无记录';
  const cycleSeed = [settings.cycleLength - 1, settings.cycleLength + 1, settings.cycleLength, settings.cycleLength - 2, settings.cycleLength + 2, settings.cycleLength];
  const heights = cycleSeed.map(v => Math.max(48, Math.min(96, 58 + (v - 24) * 5)));
  return `<h1 class="page-title">周期趋势</h1><div class="subtle">记录越完整，趋势越准确</div>
    <div class="stats"><div class="stat"><strong>${settings.cycleLength}<small>天</small></strong><span>平均周期</span></div><div class="stat"><strong>${settings.periodLength}<small>天</small></strong><span>平均经期</span></div><div class="stat"><strong>${periodRecords.length}<small>天</small></strong><span>已记录经期</span></div><div class="stat"><strong>${Object.keys(records).length}<small>天</small></strong><span>记录总数</span></div></div>
    <h2 class="section-title">周期长度</h2><div class="chart">${heights.map((h, i) => `<div class="bar ${i === 5 ? 'active' : ''}" style="height:${h}%" data-label="${['3月','4月','5月','6月','7月','本次'][i]}"></div>`).join('')}</div>
    <div class="insight"><h3>最常记录：${common}</h3><p class="subtle">最近周期预计波动在 2 天以内。预测仅供日常健康记录参考。</p></div>`;
}

function profile() {
  return `<h1 class="page-title">我的</h1><div class="subtle">数据只属于你</div>
    <div class="profile-card"><h3>本地隐私保护</h3><p class="subtle">${Object.keys(records).length ? `已有 ${Object.keys(records).length} 天记录保存在当前设备。` : '记录仅保存在当前设备，不需要注册账号。'}</p></div>
    <div class="list">${row('⌁','提醒设置', settings.reminder ? '经期前 2 天提醒' : '提醒已关闭','toggle-reminder')}${row('▣','导出数据','下载 JSON 备份','export')}${row('↺','恢复演示数据','清除记录并恢复默认','reset')}${row('?','关于预测','了解计算方式与限制','about')}</div>
    <div class="insight"><p class="subtle">阶段和日期均为估算，不能用于避孕、诊断或替代专业医疗建议。</p></div>`;
}

function flowName(value) { return ({ light: '少量', medium: '适中', heavy: '较多' })[value] || '未记录经量'; }
const pages = { today, calendar, trends, profile };

function render(page = activePage) {
  activePage = page;
  screen.innerHTML = pages[page]();
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));
  screen.scrollTop = 0;
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
    period: data.get('period') || 'no', flow: data.get('flow') || '',
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
  const key = toKey(todayDate);
  records[key] = { ...(records[key] || {}), period: value, flow: records[key]?.flow || '', symptoms: records[key]?.symptoms || [], mood: records[key]?.mood || '', note: records[key]?.note || '', updatedAt: new Date().toISOString() };
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
  if (action === 'export') return exportData();
  if (action === 'reset' && confirm('确定清除当前设备上的所有记录吗？')) { records = {}; settings = defaultSettings(); batchMode = false; batchDates = []; persist(); render('profile'); showToast('记录与周期设置已恢复'); return; }
  if (action === 'about') return alert('阶段预测基于最近一次经期开始日与平均周期估算。实际排卵日和各阶段长度会波动，不能用于避孕、诊断或替代专业医疗建议。');
  if (action === 'privacy') return showToast('本地隐私模式已开启');
});

tabs.forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.page !== 'calendar') { batchMode = false; batchDates = []; } render(tab.dataset.page); }));
dialog.addEventListener('close', () => { if (dialog.returnValue === 'save') saveRecord(); });
render('today');
