const screen=document.querySelector('#screen');
const tabs=[...document.querySelectorAll('.tab')];
const dialog=document.querySelector('#recordDialog');
const toast=document.querySelector('#toast');

const week=`<div class="week">${[['三','29'],['四','30'],['五','31'],['六','1'],['日','2'],['一','3'],['二','4']].map((d,i)=>`<div class="day ${i===6?'current':''}">${d[0]}<b>${d[1]}</b></div>`).join('')}</div>`;
const row=(icon,title,desc)=>`<button class="row"><span class="row-icon">${icon}</span><span class="row-copy"><b>${title}</b><small>${desc}</small></span><span class="chev">›</span></button>`;

function today(){return `<div class="topline"><div><h1>今天</h1><div class="date">8月4日 · 周二</div></div><button class="privacy" aria-label="隐私模式">◉</button></div>${week}<div class="cycle"><div class="cycle-content"><small>当前周期</small><strong>第 18 天</strong><span>预计 10 天后</span></div></div><button class="primary" id="openRecord">记录今天</button><p class="prediction">预计下次经期 <b>8月14日</b></p><h2 class="section-title">今日记录</h2><div class="list">${row('♡','症状与感受','尚未记录')}${row('◔','经期记录','本周期已记录 5 天')}${row('⌁','周期趋势','平均周期 28 天')}</div>`}
function calendar(){const days=['日','一','二','三','四','五','六',...Array.from({length:31},(_,i)=>i+1)];return `<h1 class="page-title">日历</h1><div class="subtle">查看和补充每天的记录</div><div class="calendar-head"><button>‹</button><b>2026年8月</b><button>›</button></div><div class="month">${days.map((d,i)=>i<7?`<span>${d}</span>`:`<button class="${i>8&&i<14?'period':''} ${d===4?'selected':''}">${d}</button>`).join('')}</div><div class="legend"><span><i class="dot"></i>经期</span><span><i class="dot predict"></i>预测经期</span></div><div class="insight"><h3>8月4日</h3><p class="subtle">周期第 18 天 · 尚未记录今天</p><button class="primary" id="openRecord">补充记录</button></div>`}
function trends(){return `<h1 class="page-title">周期趋势</h1><div class="subtle">基于最近 6 个完整周期</div><div class="stats"><div class="stat"><strong>28<small>天</small></strong><span>平均周期</span></div><div class="stat"><strong>5<small>天</small></strong><span>平均经期</span></div></div><h2 class="section-title">周期长度</h2><div class="chart">${[68,80,73,88,77,83].map((h,i)=>`<div class="bar ${i===5?'active':''}" style="height:${h}%" data-label="${['3月','4月','5月','6月','7月','本次'][i]}"></div>`).join('')}</div><div class="insight"><h3>你的周期较规律</h3><p class="subtle">最近周期波动在 3 天以内。预测仅供日常健康记录参考。</p></div>`}
function profile(){return `<h1 class="page-title">我的</h1><div class="subtle">数据只属于你</div><div class="profile-card"><h3>本地隐私保护</h3><p class="subtle">原型中的记录仅保存在当前设备，不需要注册账号。</p></div><div class="list">${row('⌁','提醒设置','经期前 2 天提醒')}${row('▣','数据与备份','导出、恢复或删除')}${row('◉','应用锁','使用面容或指纹解锁')}${row('?','关于预测','了解计算方式与限制')}</div><div class="insight"><p class="subtle">预测结果不能用于避孕、诊断或替代专业医疗建议。</p></div>`}
const pages={today,calendar,trends,profile};
function render(page){screen.innerHTML=pages[page]();tabs.forEach(t=>t.classList.toggle('active',t.dataset.page===page));document.querySelector('#openRecord')?.addEventListener('click',()=>dialog.showModal());screen.scrollTop=0}
tabs.forEach(t=>t.addEventListener('click',()=>render(t.dataset.page)));
dialog.addEventListener('close',()=>{if(dialog.returnValue==='save'){toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1800)}});
render('today');
