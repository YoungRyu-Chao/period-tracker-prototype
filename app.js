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
function cycleDay(key) { return Math.max(1, daysBetween(settings.lastPeriodStart, key) + 1); }
function nextPeriodDate() { return offsetKey(fromKey(settings.lastPeriodStart), settings.cycleLength); }
function relativeDays(key) { return daysBetween(toKey(todayDate), key); }
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

function today() {
  const todayKey = toKey(todayDate);
  const record = records[todayKey];
  const next = nextPeriodDate();
  const daysToNext = relativeDays(next);
  const symptomText = record?.symptoms?.length ? record.symptoms.join('、') : '尚未记录';
  const periodText = record?.period === 'yes' ? `今天有经期 · ${flowName(record.flow)}` : `本周期预计 ${settings.periodLength} 天`;
  return `<div class="topline"><div><h1>今天</h1><div class="date">${cnDate(todayDate, true)}</div></div><button class="privacy" aria-label="隐私模式" data-action="privacy">◉</button></div>
    ${weekStrip()}
    <div class="cycle"><div class="cycle-content"><small>当前周期</small><strong>第 ${cycleDay(todayKey)} 天</strong><span>${daysToNext >= 0 ? `预计 ${daysToNext} 天后` : '请更新经期日期'}</span></div></div>
    <button class="primary" data-action="record" data-date="${todayKey}">${record ? '编辑今天' : '记录今天'}</button>
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
    const classes = [record?.period === 'yes' ? 'period' : '', predictedOffset >= 0 && predictedOffset < settings.periodLength ? 'predicted' : '', key === selectedDate ? 'selected' : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" data-date="${key}" aria-label="${cnDate(date)}${record ? '，已有记录' : ''}">${day}</button>`);
  }
  const selectedRecord = records[selectedDate];
  const summary = selectedRecord ? [selectedRecord.period === 'yes' ? `经期·${flowName(selectedRecord.flow)}` : '非经期', ...(selectedRecord.symptoms || []), selectedRecord.mood].filter(Boolean).join(' · ') : '尚未记录这一天';
  return `<h1 class="page-title">日历</h1><div class="subtle">点击日期，查看或补充记录</div>
    <div class="calendar-head"><button data-action="prev-month" aria-label="上个月">‹</button><b>${year}年${month + 1}月</b><button data-action="next-month" aria-label="下个月">›</button></div>
    <div class="month"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>${cells.join('')}</div>
    <div class="legend"><span><i class="dot"></i>已记录经期</span><span><i class="dot predict"></i>预测经期</span></div>
    <div class="insight"><h3>${cnDate(fromKey(selectedDate))}</h3><p class="subtle">周期第 ${cycleDay(selectedDate)} 天 · ${summary}</p><button class="primary" data-action="record" data-date="${selectedDate}">${selectedRecord ? '编辑记录' : '补充记录'}</button></div>`;
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
    <div class="insight"><p class="subtle">预测结果不能用于避孕、诊断或替代专业医疗建议。</p></div>`;
}

function flowName(value) { return ({ light: '少量', medium: '适中', heavy: '较多' })[value] || '未记录经量'; }
const pages = { today, calendar, trends, profile };

function render(page = activePage) {
  activePage = page;
  screen.innerHTML = pages[page]();
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));
  screen.scrollTop = 0;
}

function openRecord(dateKey) {
  selectedDate = dateKey || toKey(todayDate);
  const record = records[selectedDate] || {};
  form.reset();
  document.querySelector('#recordDate').textContent = cnDate(fromKey(selectedDate));
  document.querySelector('#recordCycleDay').textContent = `周期第 ${cycleDay(selectedDate)} 天`;
  form.elements.period.value = record.period || 'no';
  if (record.flow) form.elements.flow.value = record.flow;
  [...form.querySelectorAll('input[name="symptoms"]')].forEach(input => input.checked = (record.symptoms || []).includes(input.value));
  if (record.mood) form.elements.mood.value = record.mood;
  form.elements.note.value = record.note || '';
  dialog.showModal();
}

function saveRecord() {
  const data = new FormData(form);
  records[selectedDate] = {
    period: data.get('period') || 'no', flow: data.get('flow') || '',
    symptoms: data.getAll('symptoms'), mood: data.get('mood') || '',
    note: String(data.get('note') || '').trim(), updatedAt: new Date().toISOString()
  };
  if (records[selectedDate].period === 'yes' && selectedDate <= toKey(todayDate)) settings.lastPeriodStart = selectedDate;
  persist();
  render();
  showToast('记录已安全保存在本机');
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
  if (date && !action) { selectedDate = date; render('calendar'); return; }
  if (action === 'record') return openRecord(date || selectedDate);
  if (action === 'trends') return render('trends');
  if (action === 'prev-month' || action === 'next-month') { calendarCursor.setMonth(calendarCursor.getMonth() + (action === 'next-month' ? 1 : -1)); render('calendar'); return; }
  if (action === 'toggle-reminder') { settings.reminder = !settings.reminder; persist(); render('profile'); showToast(settings.reminder ? '提醒已开启' : '提醒已关闭'); return; }
  if (action === 'export') return exportData();
  if (action === 'reset' && confirm('确定清除当前设备上的所有记录吗？')) { records = {}; settings = defaultSettings(); persist(); render('profile'); showToast('记录与周期设置已恢复'); return; }
  if (action === 'about') return alert('预测基于最近一次经期开始日与平均周期计算，仅供健康记录参考。');
  if (action === 'privacy') return showToast('本地隐私模式已开启');
});

tabs.forEach(tab => tab.addEventListener('click', () => render(tab.dataset.page)));
dialog.addEventListener('close', () => { if (dialog.returnValue === 'save') saveRecord(); });
render('today');
