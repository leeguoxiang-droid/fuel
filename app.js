'use strict';
// 打油记录：资料先存在手机（localStorage），有设定 GitHub 就自动同步到私有仓库的一个 JSON 档。
(() => {
  const LS = { data: 'fuel-data', cfg: 'fuel-sync', ui: 'fuel-ui' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let db = store.get(LS.data, null) || { meta: { car: '我的车', updatedAt: 0 }, records: [], dirty: false };
  let cfg = store.get(LS.cfg, null) || { owner: '', repo: '', path: 'fuel.json', token: '' };
  cfg.token = (cfg.token || '').replace(/[^!-~]/g, '');
  let ui = store.get(LS.ui, null) || { tab: 'home', range: '12', theme: 'auto' };
  let editSeq = 0;
  const saveDB = () => store.set(LS.data, db);
  const saveUI = () => store.set(LS.ui, ui);
  const FUEL_NAME = 'RON95汽油';
  // 旧记录的「中级汽油」统一改名（改了会跟着同步上去）
  const migrate = (recs) => recs.map((r) => (r.type === 'fuel' && (!r.item || r.item === '中级汽油') ? { ...r, item: FUEL_NAME, updatedAt: Date.now() } : r));
  { const m = migrate(db.records); if (m.some((r, i) => r !== db.records[i])) { db.records = m; db.dirty = true; saveDB(); } }

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null; };
  const fmt = (n, d) => n.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rm = (n) => 'RM' + fmt(n, 2);
  const km = (n) => Math.round(n).toLocaleString('en-MY');
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());
  const addDays = (s, k) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + k); return isoDay(d); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 864e5);
  const ym = (s) => s.slice(0, 7);
  const addMonths = (m, k) => { let y = +m.slice(0, 4), mo = +m.slice(5) + k; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${pad(mo)}`; };
  const monthsBetween = (a, b) => { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; };
  const monthName = (m) => `${m.slice(0, 4)}年${+m.slice(5)}月`;
  const md = (s) => `${+s.slice(5, 7)}月${+s.slice(8)}日`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const byDateOdo = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const ICON = {
    fuel: '<svg viewBox="0 0 24 24"><path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M6 8h6M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
    service: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.7-.7-2.6z"/></svg>',
  };

  // ---------- 计算 ----------
  // 油耗沿用 Drivvo 的算法：某一笔的 km/L =（下一笔里程 − 这一笔里程）÷ 下一笔的公升数
  function analyze() {
    const recs = db.records.filter((r) => !r.deleted).sort(byDateOdo);
    const fuel = recs.filter((r) => r.type === 'fuel');
    const info = new Map();
    fuel.forEach((r, i) => {
      const p = fuel[i - 1], n = fuel[i + 1];
      info.set(r.id, {
        dist: p ? r.odo - p.odo : null,                       // 上一笔到这一笔开了多远（用掉这一笔的油）
        kmL: n && n.liters ? (n.odo - r.odo) / n.liters : null, // 显示在这一笔上的油耗
      });
    });
    return { recs, fuel, info };
  }

  function agg(fills, info) {
    let spend = 0, liters = 0, dist = 0, distL = 0, distRM = 0;
    for (const r of fills) {
      spend += r.total; liters += r.liters || 0;
      const d = info.get(r.id)?.dist;
      if (d != null && d > 0 && r.liters) { dist += d; distL += r.liters; distRM += r.total; }
    }
    return { n: fills.length, spend, liters, dist, kmL: distL ? dist / distL : null, rmKm: dist ? distRM / dist : null };
  }

  // ---------- 画面 ----------
  function render() {
    document.documentElement.toggleAttribute('data-theme', ui.theme !== 'auto');
    if (ui.theme !== 'auto') document.documentElement.dataset.theme = ui.theme;
    carHead();
    document.querySelectorAll('.tabs [data-tab], .top [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    renderSync();
    const A = analyze();
    const v = $('#view');
    if (mapObj) { mapObj.remove(); mapObj = null; }
    v.innerHTML = ({ home: viewHome, list: viewList, stats: viewStats, set: viewSet, map: viewMap }[ui.tab] || viewHome)(A);
    if (ui.tab === 'map') drawMap();
    if (ui.tab === 'stats') drawCharts(A);
    if (ui.tab === 'set') fillSettings();
  }

  function carHead() {
    $('#car').innerHTML = esc(db.meta.car || '我的车') + (db.meta.model ? `<small>${esc(db.meta.model)}</small>` : '');
  }

  function rowHTML(r, A) {
    const i = A.info.get(r.id);
    let title, sub;
    if (r.type === 'fuel') {
      title = r.station?.name || r.item || FUEL_NAME;
      sub = [`${km(r.odo)} km`, i && i.kmL != null ? `<b>${fmt(i.kmL, 3)} km/L</b>` : '', r.liters ? `${fmt(r.liters, 3)} L` : ''].filter(Boolean).join(' · ');
    } else {
      title = r.item || '服务';
      sub = [`${km(r.odo)} km`, esc(r.note)].filter(Boolean).join(' · ');
    }
    return `<button class="row" type="button" data-id="${esc(r.id)}">
      <span class="ico ${r.type}">${ICON[r.type]}</span>
      <span class="main">
        <span class="t1"><span class="name">${esc(title)}</span><span class="amt">${rm(r.total)}</span></span>
        <span class="t2"><span>${sub}</span><span class="date">${md(r.date)}</span></span>
      </span></button>`;
  }

  function viewHome(A) {
    const last = A.fuel.at(-1);
    if (!last) return `<div class="empty">还没有打油记录。<br>按下面的 ＋ 记第一次加油，<br>或到「设置」导入 Drivvo 的 CSV。</div>`;
    const m = ym(today());
    const cur = agg(A.fuel.filter((r) => ym(r.date) === m), A.info);
    const prev = agg(A.fuel.filter((r) => ym(r.date) === addMonths(m, -1)), A.info);
    const q = agg(A.fuel.filter((r) => r.date > addDays(today(), -90)), A.info);
    const li = A.info.get(last.id);
    const lastKmL = li.dist && last.liters ? li.dist / last.liters : null;
    const recent = A.fuel.slice(-11);
    let next = '';
    if (recent.length >= 3) {
      const gaps = recent.length - 1;
      const avgKm = (recent.at(-1).odo - recent[0].odo) / gaps;
      const avgDays = daysBetween(recent[0].date, recent.at(-1).date) / gaps;
      next = `<div class="tile"><div class="label">下次加油（估计）</div><div class="value">${km(last.odo + avgKm)}<small>km</small></div><div class="sub">约 ${md(addDays(last.date, Math.round(avgDays)))} · 平均 ${km(avgKm)} km 加一次</div></div>`;
    }
    const ago = daysBetween(last.date, today());
    return `
      <div class="card hero">
        <div class="label">${+m.slice(5)}月油费</div>
        <div class="value"><small>RM</small>${fmt(cur.spend, 2)}</div>
        <div class="sub">${cur.n} 次加油 · 上个月 ${rm(prev.spend)}</div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="label">最近一次油耗</div><div class="value">${lastKmL ? fmt(lastKmL, 2) : '—'}<small>km/L</small></div><div class="sub">${li.dist ? `上次到这次 ${km(li.dist)} km` : '要两笔才算得出'}</div></div>
        <div class="tile"><div class="label">近 3 个月平均</div><div class="value">${q.kmL ? fmt(q.kmL, 2) : '—'}<small>km/L</small></div><div class="sub">${q.n} 次加油</div></div>
        <div class="tile"><div class="label">每公里油费</div><div class="value">${q.rmKm ? fmt(q.rmKm, 3) : '—'}<small>RM/km</small></div><div class="sub">近 3 个月</div></div>
        ${next}
      </div>
      <div class="card">
        <h2>上次加油<small>${ago === 0 ? '今天' : ago + ' 天前'}</small></h2>
        <div>${last.station?.name ? `${esc(last.station.name)}<br>` : ''}${md(last.date)} · ${km(last.odo)} km · <b>${rm(last.total)}</b> · ${fmt(last.liters, 3)} L · RM${fmt(last.price, 2)}/L</div>
      </div>
      <div class="month"><b>最近记录</b></div>
      <div class="list">${A.recs.slice(-5).reverse().map((r) => rowHTML(r, A)).join('')}</div>
      <button class="link" data-tab="list" type="button">全部记录 →</button>`;
  }

  function viewList(A) {
    if (!A.recs.length) return `<div class="empty">还没有记录。</div>`;
    const groups = new Map();
    for (const r of [...A.recs].reverse()) {
      const k = ym(r.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let out = '';
    for (const [m, rs] of groups) {
      const f = agg(rs.filter((r) => r.type === 'fuel'), A.info);
      const svc = rs.filter((r) => r.type === 'service').reduce((s, r) => s + r.total, 0);
      const bits = [`油费 ${rm(f.spend)}`];
      if (svc) bits.push(`服务 ${rm(svc)}`);
      if (f.kmL) bits.push(`${fmt(f.kmL, 2)} km/L`);
      out += `<div class="month"><b>${monthName(m)}</b><span>${bits.join(' · ')}</span></div><div class="list">${rs.map((r) => rowHTML(r, A)).join('')}</div>`;
    }
    return out;
  }

  function rangeMonths(A) {
    const end = ym(today());
    if (ui.range === 'all') return monthsBetween(A.recs.length ? ym(A.recs[0].date) : end, end);
    return monthsBetween(addMonths(end, -(+ui.range - 1)), end);
  }

  let chartData = null;
  function viewStats(A) {
    if (!A.fuel.length) return `<div class="empty">还没有打油记录。</div>`;
    const months = rangeMonths(A);
    const inRange = A.fuel.filter((r) => ym(r.date) >= months[0]);
    const t = agg(inRange, A.info);
    const rows = months.map((m) => ({ m, ...agg(A.fuel.filter((r) => ym(r.date) === m), A.info) }));
    chartData = rows;
    const chip = (k, label) => `<button type="button" data-range="${k}" class="${ui.range === k ? 'on' : ''}">${label}</button>`;
    return `
      <div class="chips">${chip('6', '6 个月')}${chip('12', '12 个月')}${chip('all', '全部')}</div>
      <div class="tiles">
        <div class="tile"><div class="label">油费合计</div><div class="value">${rm(t.spend)}</div><div class="sub">${t.n} 次 · 每月平均 ${rm(t.spend / months.length)}</div></div>
        <div class="tile"><div class="label">平均油耗</div><div class="value">${t.kmL ? fmt(t.kmL, 2) : '—'}<small>km/L</small></div><div class="sub">共 ${fmt(t.liters, 1)} L</div></div>
        <div class="tile"><div class="label">每公里油费</div><div class="value">${t.rmKm ? fmt(t.rmKm, 3) : '—'}<small>RM/km</small></div><div class="sub">行驶 ${km(t.dist)} km</div></div>
        <div class="tile"><div class="label">平均每次</div><div class="value">${t.n ? rm(t.spend / t.n) : '—'}</div><div class="sub">${t.n ? fmt(t.liters / t.n, 1) + ' L' : ''}</div></div>
      </div>
      <div class="card"><h2>每月油费<small>RM</small></h2><div class="chart" id="c-spend"></div></div>
      <div class="card"><h2>每月平均油耗<small>km/L</small></h2><div class="chart" id="c-kml"></div></div>
      <div class="card"><h2>每月明细</h2>
        <table><thead><tr><th>月份</th><th>次数</th><th>油费</th><th>公升</th><th>km/L</th></tr></thead><tbody>
        ${[...rows].reverse().map((r) => `<tr><td>${monthName(r.m)}</td><td>${r.n || ''}</td><td>${r.n ? fmt(r.spend, 2) : '—'}</td><td>${r.n ? fmt(r.liters, 1) : ''}</td><td>${r.kmL ? fmt(r.kmL, 2) : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
  }

  function viewSet() {
    return `
      <div class="card"><h2>车辆</h2>
        <div class="pair"><label class="field"><span>车牌</span><input id="s-car" maxlength="20" autocapitalize="characters"></label><label class="field"><span>车型</span><input id="s-model" maxlength="40" placeholder="例：Perodua Alza 2022"></label></div>
        <label class="field"><span>外观</span><select id="s-theme"><option value="auto">跟随手机</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      </div>
      <div class="card"><h2>GitHub 同步</h2>
        <p class="status" id="s-status"></p>
        <label class="field"><span>GitHub 账号</span><input id="s-owner" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>私有仓库名称</span><input id="s-repo" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="fuel-data"></label>
        <label class="field"><span>档名</span><input id="s-path" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>令牌（token）</span><input id="s-token" type="password" autocomplete="off" spellcheck="false"><span class="hint">只存在这部手机里，不会上传到程序仓库。</span></label>
        <div class="btns"><button class="btn primary" type="button" data-act="savecfg">保存并同步</button><button class="btn danger" type="button" data-act="clearcfg">清除令牌</button></div>
        <details style="margin-top:12px"><summary class="muted">令牌怎么开？</summary>
          <ol class="steps" style="margin-top:8px">
            <li>GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token。</li>
            <li>Repository access 选 <b>Only select repositories</b>，只选放数据的私有仓库。</li>
            <li>Permissions → Repository permissions → <b>Contents</b> 选 <b>Read and write</b>，其他不用开。</li>
            <li>按 Generate，复制令牌贴到上面。令牌过期后照样再开一个。</li>
          </ol></details>
      </div>
      <div class="card"><h2>数据</h2>
        <div class="btns">
          <button class="btn" type="button" data-act="importcsv">导入 CSV</button>
          <button class="btn" type="button" data-act="exportcsv">导出 CSV</button>
          <button class="btn" type="button" data-act="exportjson">备份 JSON</button>
          <button class="btn" type="button" data-act="importjson">从 JSON 还原</button>
        </div>
        <p class="status" style="margin-top:10px">导入时同一天、同一里程的记录会覆盖，不会重复。</p>
        <input type="file" id="f-csv" accept=".csv,text/csv" hidden>
        <input type="file" id="f-json" accept=".json,application/json" hidden>
      </div>
      <p class="muted" style="text-align:center;font-size:12px">共 ${db.records.filter((r) => !r.deleted).length} 笔记录</p>`;
  }

  function fillSettings() {
    $('#s-car').value = db.meta.car || '';
    $('#s-model').value = db.meta.model || '';
    $('#s-theme').value = ui.theme;
    $('#s-owner').value = cfg.owner; $('#s-repo').value = cfg.repo;
    $('#s-path').value = cfg.path || 'fuel.json'; $('#s-token').value = cfg.token;
    $('#s-status').textContent = syncText(true);
    const carChange = () => {
      db.meta = { car: $('#s-car').value.trim() || '我的车', model: $('#s-model').value.trim(), updatedAt: Date.now() };
      db.dirty = true; editSeq++; saveDB(); carHead(); scheduleSync();
    };
    $('#s-car').addEventListener('change', carChange);
    $('#s-model').addEventListener('change', carChange);
    $('#s-theme').addEventListener('change', (e) => { ui.theme = e.target.value; saveUI(); render(); });
    $('#f-csv').addEventListener('change', (e) => readFile(e.target, (t) => {
      const r = importCSV(t);
      toast(`导入 ${r.added + r.updated} 笔（新增 ${r.added}，覆盖 ${r.updated}${r.skipped ? `，跳过 ${r.skipped}` : ''}）`);
    }));
    $('#f-json').addEventListener('change', (e) => readFile(e.target, (t) => {
      try {
        const j = JSON.parse(t);
        if (!Array.isArray(j.records)) throw 0;
        db.records = merge(db.records, j.records);
        if (j.meta && (j.meta.updatedAt || 0) > (db.meta.updatedAt || 0)) db.meta = j.meta;
        db.dirty = true; editSeq++; saveDB(); render(); scheduleSync();
        toast(`已还原 ${j.records.length} 笔`);
      } catch { toast('这不是打油记录的备份档'); }
    }));
  }

  function readFile(input, cb) {
    const f = input.files[0]; if (!f) return;
    f.text().then(cb).finally(() => { input.value = ''; });
  }

  // ---------- 图表 ----------
  function niceTicks(lo, hi, count) {
    const raw = (hi - lo || 1) / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(+v.toFixed(6));
    return out;
  }
  const tickText = (v) => (v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + 'K' : String(v));
  function xLabels(months) {
    const n = months.length;
    return months.map((m, i) => {
      if (n <= 7) return `${+m.slice(5)}月`;
      if (n <= 13) return (n - 1 - i) % 2 === 0 ? `${+m.slice(5)}月` : '';
      return m.endsWith('-01') ? m.slice(0, 4) : '';
    });
  }

  function drawCharts() {
    if (!chartData) return;
    const rows = chartData;
    drawBars($('#c-spend'), rows);
    drawLine($('#c-kml'), rows);
  }

  const G = { H: 190, L: 40, R: 10, T: 22, B: 24 };

  function chartFrame(host, ticks, y, W) {
    let s = '';
    for (const v of ticks) s += `<line class="grid" x1="${G.L}" x2="${W - G.R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${G.L - 6}" y="${y(v) + 4}" text-anchor="end">${tickText(v)}</text>`;
    return s;
  }

  function xAxis(rows, xOf, W) {
    const labels = xLabels(rows.map((r) => r.m));
    return labels.map((t, i) => {
      if (!t) return '';
      const x = Math.min(Math.max(xOf(i), G.L + 12), W - G.R - 12);
      return `<text class="tick" x="${x}" y="${G.H - 6}" text-anchor="middle">${t}</text>`;
    }).join('');
  }

  function drawBars(host, rows) {
    const W = host.clientWidth || 320, n = rows.length;
    const max = Math.max(...rows.map((r) => r.spend), 1);
    const ticks = niceTicks(0, max, 4), top = ticks.at(-1);
    const pw = W - G.L - G.R, ph = G.H - G.T - G.B, band = pw / n;
    const bw = Math.max(2, Math.min(24, band * 0.62, band - 2));
    const y = (v) => G.T + ph - (v / top) * ph, y0 = y(0);
    const xOf = (i) => G.L + band * i + band / 2;
    let s = chartFrame(host, ticks, y, W);
    rows.forEach((r, i) => {
      if (!r.spend) return;
      const x = xOf(i) - bw / 2, yt = y(r.spend), rr = Math.min(4, bw / 2, y0 - yt);
      s += `<path class="bar" data-i="${i}" d="M${x},${y0}V${yt + rr}A${rr},${rr} 0 0 1 ${x + rr},${yt}H${x + bw - rr}A${rr},${rr} 0 0 1 ${x + bw},${yt + rr}V${y0}Z"/>`;
    });
    s += `<line class="base" x1="${G.L}" x2="${W - G.R}" y1="${y0}" y2="${y0}"/>`;
    // 只标最高和最新两根
    const withVal = rows.map((r, i) => [r.spend, i]).filter((p) => p[0] > 0);
    if (withVal.length) {
      const hi = withVal.reduce((a, b) => (b[0] > a[0] ? b : a))[1], last = withVal.at(-1)[1];
      for (const i of new Set([hi, last])) {
        if (i !== last && Math.abs(i - last) * band < 44) continue;
        const x = Math.min(Math.max(xOf(i), G.L + 14), W - 14);
        s += `<text class="vlabel" x="${x}" y="${y(rows[i].spend) - 6}" text-anchor="middle">${fmt(rows[i].spend, 0)}</text>`;
      }
    }
    s += xAxis(rows, xOf, W);
    mount(host, W, s, '每月油费柱状图', n, xOf, band, (i) => {
      host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('sel', +b.dataset.i === i));
      const r = rows[i];
      return [monthName(r.m), r.n ? rm(r.spend) : '没有加油', r.n ? `${r.n} 次加油 · ${fmt(r.liters, 1)} L` : ''];
    });
  }

  function drawLine(host, rows) {
    const W = host.clientWidth || 320, n = rows.length;
    const vals = rows.map((r) => r.kmL).filter((v) => v != null);
    if (!vals.length) { host.innerHTML = '<p class="muted">要至少两笔加油才算得出油耗。</p>'; return; }
    const ticks = niceTicks(Math.floor(Math.min(...vals) - 0.5), Math.ceil(Math.max(...vals) + 0.5), 4);
    const lo = ticks[0], hi = ticks.at(-1);
    const pw = W - G.L - G.R, ph = G.H - G.T - G.B, band = pw / n;
    const y = (v) => G.T + ph - ((v - lo) / (hi - lo)) * ph;
    const xOf = (i) => G.L + band * i + band / 2;
    let s = chartFrame(host, ticks, y, W);
    let d = '', pen = false;
    rows.forEach((r, i) => {
      if (r.kmL == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)},${y(r.kmL).toFixed(1)}`; pen = true;
    });
    s += `<path class="line" d="${d}"/>`;
    if (n <= 12) rows.forEach((r, i) => { if (r.kmL != null) s += `<circle class="dot" cx="${xOf(i)}" cy="${y(r.kmL)}" r="4"/>`; });
    const lastI = rows.map((r) => r.kmL != null).lastIndexOf(true);
    if (n > 12) s += `<circle class="dot" cx="${xOf(lastI)}" cy="${y(rows[lastI].kmL)}" r="4"/>`;
    const prevI = rows.slice(0, lastI).map((r) => r.kmL != null).lastIndexOf(true);
    const below = prevI >= 0 && rows[prevI].kmL > rows[lastI].kmL; // 线从上方下来时，数字放在点下面
    s += `<text class="vlabel" x="${Math.min(xOf(lastI), W - 16)}" y="${y(rows[lastI].kmL) + (below ? 20 : -10)}" text-anchor="middle">${fmt(rows[lastI].kmL, 2)}</text>`;
    s += `<line class="cross" x1="0" x2="0" y1="${G.T}" y2="${G.T + ph}" visibility="hidden"/><circle class="dot hov" r="5" visibility="hidden"/>`;
    s += xAxis(rows, xOf, W);
    mount(host, W, s, '每月平均油耗折线图', n, xOf, band, (i) => {
      const r = rows[i], cross = host.querySelector('.cross'), dot = host.querySelector('.hov');
      cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i)); cross.setAttribute('visibility', 'visible');
      if (r.kmL != null) { dot.setAttribute('cx', xOf(i)); dot.setAttribute('cy', y(r.kmL)); dot.setAttribute('visibility', 'visible'); }
      else dot.setAttribute('visibility', 'hidden');
      return [monthName(r.m), r.kmL != null ? `${fmt(r.kmL, 2)} km/L` : '算不出', r.kmL != null ? `行驶 ${km(r.dist)} km` : ''];
    });
  }

  // 装上 SVG 和提示框：点或拖到哪个月就显示哪个月
  function mount(host, W, inner, label, n, xOf, band, onPick) {
    host.innerHTML = `<svg viewBox="0 0 ${W} ${G.H}" width="${W}" height="${G.H}" role="img" aria-label="${label}" tabindex="0">${inner}</svg><div class="tip" hidden></div>`;
    const svg = host.querySelector('svg'), tip = host.querySelector('.tip');
    let cur = -1;
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      const [k, v, extra] = onPick(cur);
      host.classList.add('hover');
      tip.replaceChildren();
      const kv = document.createElement('div'); kv.className = 'v'; kv.textContent = v;
      const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = extra ? `${k} · ${extra}` : k;
      tip.append(kv, kk); tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, xOf(cur) - tw / 2)) + 'px';
      tip.style.top = '-8px';
    };
    const hide = () => {
      cur = -1; tip.hidden = true; host.classList.remove('hover');
      host.querySelectorAll('.cross,.hov').forEach((e) => e.setAttribute('visibility', 'hidden'));
    };
    const pick = (e) => {
      const r = svg.getBoundingClientRect();
      show(Math.floor(((e.clientX - r.left) * (W / r.width) - G.L) / band));
    };
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) pick(e); });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { show(cur < 0 ? n - 1 : cur + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(cur < 0 ? n - 1 : cur - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
    document.addEventListener('pointerdown', (e) => { if (!host.contains(e.target)) hide(); }, { capture: true });
  }

  // ---------- 油站与地图 ----------
  const stKey = (s) => s.id || `${s.name}|${s.lat != null ? s.lat.toFixed(4) + ',' + s.lon.toFixed(4) : ''}`;
  function stations(A) {
    const m = new Map();
    for (const r of A.fuel) {
      const s = r.station; if (!s || !s.name) continue;
      const k = stKey(s), o = m.get(k) || { s, n: 0, spend: 0, last: null };
      o.n++; o.spend += r.total; o.last = r; o.s = s; m.set(k, o);
    }
    return [...m.values()];
  }
  const dist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${fmt(m / 1000, 1)} km`);
  const haversine = (a, b, c, d) => { const t = Math.PI / 180, x = Math.sin(((c - a) * t) / 2), y = Math.sin(((d - b) * t) / 2); return 2 * 6371e3 * Math.asin(Math.sqrt(x * x + Math.cos(a * t) * Math.cos(c * t) * y * y)); };
  // 附近油站来自 OpenStreetMap（Overpass），免费、不用钥匙
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  async function overpass(q) {
    let last;
    for (const url of OVERPASS) {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 35000);
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
        if (res.ok) return (await res.json()).elements || [];
        last = new Error('overpass ' + res.status);
      } catch (e) { last = e; } finally { clearTimeout(timer); }
    }
    throw last;
  }
  async function nearbyStations(lat, lon) {
    for (const rad of [5000]) {
      const els = await overpass(`[out:json][timeout:30];(node["amenity"="fuel"](around:${rad},${lat},${lon});way["amenity"="fuel"](around:${rad},${lat},${lon}););out center tags;`);
      const list = els.filter((e) => (e.lat ?? e.center?.lat) != null).map((e) => {
        const t = e.tags || {}, la = e.lat ?? e.center.lat, lo = e.lon ?? e.center.lon;
        const name = t.name || t['name:en'] || t.brand || t.operator || '无名油站';
        const brand = t.brand || t.operator || '';
        return { id: e.type[0] + e.id, name, sub: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : (t['addr:street'] || ''), lat: +la.toFixed(6), lon: +lo.toFixed(6), d: haversine(lat, lon, la, lo) };
      }).sort((a, b) => a.d - b.d).slice(0, 12);
      return list;
    }
  }

  let mapObj = null, mapMarks = [], mapData = null, leafletP = null, nearMap = null;
  function viewMap(A) {
    const st = stations(A).filter((o) => o.s.lat != null).sort((a, b) => b.n - a.n || (a.last.date < b.last.date ? 1 : -1));
    mapData = st;
    if (!st.length) return `<div class="card"><div class="map" id="map"></div></div><p class="muted" style="text-align:center;font-size:13px">还没有标记。以后记加油时在「油站」按「附近」选一个，<br>去过的油站就会标在这张地图上。</p>`;
    return `<div class="card"><div class="map" id="map"></div></div>
      <div class="month"><b>去过的油站</b><span>${st.length} 个</span></div>
      <div class="list">${st.map((o, i) => `<button class="row" type="button" data-stn="${i}"><span class="ico fuel">${ICON.fuel}</span><span class="main"><span class="t1"><span class="name">${esc(o.s.name)}</span><span class="amt">${o.n} 次</span></span><span class="t2"><span>最近 RM${fmt(o.last.price, 2)}/L · 合计 ${rm(o.spend)}</span><span class="date">${md(o.last.date)}</span></span></span></button>`).join('')}</div>`;
  }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return (leafletP ||= new Promise((ok, no) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(css);
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = ok; s.onerror = () => { leafletP = null; no(); }; document.head.append(s);
    }));
  }
  function drawMap() {
    const st = mapData || [];
    loadLeaflet().then(() => {
      const el = $('#map'); if (!el || ui.tab !== 'map') return;
      if (mapObj) mapObj.remove();
      mapObj = L.map(el);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapObj);
      const css = getComputedStyle(document.documentElement);
      const fill = css.getPropertyValue('--fuel').trim(), ring = css.getPropertyValue('--surface').trim();
      mapMarks = st.map((o) => L.circleMarker([o.s.lat, o.s.lon], { radius: 9, color: ring, weight: 2, fillColor: fill, fillOpacity: 1 })
        .bindPopup(`<b>${esc(o.s.name)}</b><br>去过 ${o.n} 次 · 最近 ${md(o.last.date)}<br>RM${fmt(o.last.price, 2)}/L`).addTo(mapObj));
      if (st.length) mapObj.fitBounds(L.latLngBounds(st.map((o) => [o.s.lat, o.s.lon])), { padding: [30, 30], maxZoom: 15 });
      else {
        mapObj.setView([4.2, 102.0], 6); // 先显示全马，定位到了再移过去
        const m = mapObj;
        navigator.geolocation?.getCurrentPosition((p) => {
          if (mapObj !== m) return;
          const ll = [p.coords.latitude, p.coords.longitude];
          m.setView(ll, 14);
          L.circleMarker(ll, { radius: 7, color: ring, weight: 2, fillColor: css.getPropertyValue('--accent').trim(), fillOpacity: 1 }).bindPopup('你在这里').addTo(m);
        }, () => {}, { timeout: 15000, maximumAge: 300000 });
      }
    }).catch(() => { const el = $('#map'); if (el) el.innerHTML = '<p class="empty">地图载入不了，检查网络。</p>'; });
  }

  // ---------- 新增／编辑 ----------
  let sheetOpen = false;
  function openSheet(rec, kind) {
    const A = analyze();
    const lastFuel = A.fuel.at(-1);
    const lastAny = A.recs.at(-1);
    const r = rec ? { ...rec } : { id: uid(), type: kind || 'fuel', date: today(), odo: '', total: '', price: lastFuel ? lastFuel.price : '', liters: '', station: null, item: '', note: '' };
    const sh = $('#sheet');
    const favs = stations(A).sort((a, b) => b.n - a.n || (a.last.date < b.last.date ? 1 : -1)).slice(0, 4).map((o) => o.s);
    let nearList = [];
    if (nearMap) { nearMap.remove(); nearMap = null; }
    const draw = () => {
      const fuel = r.type === 'fuel';
      sh.innerHTML = `
        <div class="bar"><button type="button" data-act="close">取消</button><h1>${rec ? '修改记录' : fuel ? '记一次加油' : '记一笔服务'}</h1><button type="button" class="save" data-act="save">保存</button></div>
        <form autocomplete="off">
          ${rec ? '' : `<div class="seg"><button type="button" data-kind="fuel" class="${fuel ? 'on' : ''}">加油</button><button type="button" data-kind="service" class="${fuel ? '' : 'on'}">服务／保养</button></div>`}
          <div class="pair">
            <label class="field"><span>日期</span><input name="date" type="date" required value="${esc(r.date)}"></label>
            <label class="field"><span>里程表（km）</span><input name="odo" inputmode="numeric" value="${esc(r.odo)}" placeholder="${lastAny ? km(lastAny.odo) : ''}"></label>
          </div>
          ${fuel ? `
          <div class="field"><span>油站</span>
            <div class="stn"><input name="stname" value="${esc(r.stname ?? r.station?.name ?? '')}" placeholder="打名字，或按「附近」找"><button class="btn" type="button" data-act="near">附近</button></div>
            ${favs.length ? `<div class="qchips">${favs.map((s, i) => `<button type="button" data-q="${i}">${esc(s.name)}</button>`).join('')}</div>` : ''}
            <div class="near" id="near"></div>
          </div>
          <div class="pair">
            <label class="field"><span>总额（RM）</span><input name="total" inputmode="decimal" value="${esc(r.total)}"></label>
            <label class="field"><span>单价（RM/L）</span><input name="price" inputmode="decimal" value="${esc(r.price)}"></label>
          </div>
          <label class="field"><span>公升（L）</span><input name="liters" inputmode="decimal" value="${esc(r.liters)}"><span class="hint">填了总额和单价会自动算；油站单据上有公升数就照抄。</span></label>
          <label class="field"><span>油种</span><input name="item" value="${esc(r.item || FUEL_NAME)}"></label>
          
          <label class="field"><span>备注</span><input name="note" value="${esc(r.note)}"></label>` : `
          <label class="field"><span>项目</span><input name="item" value="${esc(r.item)}" placeholder="例：换机油"></label>
          <label class="field"><span>金额（RM）</span><input name="total" inputmode="decimal" value="${esc(r.total)}"></label>
          <label class="field"><span>店家／备注</span><input name="note" value="${esc(r.note)}"></label>`}
          <p class="err" id="err"></p>
          ${rec ? '<div class="btns"><button class="btn danger" type="button" data-act="del">删除这一笔</button></div>' : ''}
        </form>`;
      const f = sh.querySelector('form');
      let litersTouched = !!(rec && rec.liters);
      const calc = () => {
        const t = num(f.total.value), p = num(f.price.value);
        if (!litersTouched && t && p) f.liters.value = (t / p).toFixed(3);
      };
      if (fuel) {
        f.total.addEventListener('input', calc);
        f.price.addEventListener('input', calc);
        f.liters.addEventListener('input', () => { litersTouched = f.liters.value.trim() !== ''; });
        f.stname.addEventListener('input', () => { r.stname = f.stname.value.trim(); if (r.station && r.station.name !== r.stname) r.station = null; });
      }
      f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    };
    const collect = () => {
      const f = sh.querySelector('form');
      r.date = f.date.value; r.odo = f.odo.value; r.total = f.total.value; r.note = f.note.value.trim(); r.item = f.item.value.trim();
      if (r.type === 'fuel') { r.price = f.price.value; r.liters = f.liters.value; r.stname = f.stname.value.trim(); }
    };
    const save = () => {
      collect();
      const err = (m) => { $('#err').textContent = m; };
      const odo = num(r.odo), total = num(r.total);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return err('请填日期');
      if (!odo || odo <= 0) return err('请填里程表读数');
      if (!total || total <= 0) return err('请填金额');
      const out = { id: r.id, type: r.type, date: r.date, odo: Math.round(odo), total: Math.round(total * 100) / 100, item: r.item, note: r.note };
      if (r.type === 'fuel') {
        let liters = num(r.liters), price = num(r.price);
        if (!liters && price) liters = total / price;
        if (!liters) return err('请填公升，或填单价让它自动算');
        out.liters = Math.round(liters * 1000) / 1000;
        out.price = Math.round((price && Math.abs(total / price - liters) < 0.02 ? price : total / liters) * 100) / 100;
        const nm = r.stname || '';
        if (nm) out.station = r.station && r.station.name === nm ? r.station : (favs.concat(stations(analyze()).map((o) => o.s)).find((s) => s.name === nm && s.lat != null) || { name: nm });
        out.item = r.item || FUEL_NAME;
        // 里程要跟前后两笔对得上
        const others = analyze().fuel.filter((x) => x.id !== r.id);
        const before = others.filter((x) => x.date < out.date || (x.date === out.date && x.odo < out.odo)).at(-1);
        const after = others.find((x) => x.date > out.date);
        if (before && before.odo >= out.odo) return err(`里程比 ${md(before.date)} 那次（${km(before.odo)} km）还小，请检查`);
        if (after && after.odo <= out.odo) return err(`里程比 ${md(after.date)} 那次（${km(after.odo)} km）还大，请检查`);
      }
      upsert(out);
      closeSheet();
      toast(rec ? '已修改' : '已记下');
    };
    sh.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.kind) { collect(); r.type = b.dataset.kind; if (r.type === 'service') r.item = ''; draw(); return; }
      if (b.dataset.q != null) { pickStation(favs[+b.dataset.q]); return; }
      if (b.dataset.pick != null) { pickStation(nearList[+b.dataset.pick]); return; }
      const act = b.dataset.act;
      if (act === 'near') findNear();
      else if (act === 'close') closeSheet();
      else if (act === 'save') save();
      else if (act === 'del' && confirm(`删除 ${md(rec.date)} ${rm(rec.total)} 这一笔？`)) {
        upsert({ id: rec.id, deleted: true });
        closeSheet(); toast('已删除');
      }
    };
    const pickStation = (s) => {
      if (!s) return;
      r.station = { id: s.id, name: s.name, lat: s.lat, lon: s.lon };
      r.stname = s.name;
      const f = sh.querySelector('form'); if (f && f.stname) f.stname.value = s.name;
      if (nearMap) { nearMap.remove(); nearMap = null; }
      const box = $('#near'); if (box) box.innerHTML = '';
    };
    const findNear = async () => {
      const msg = (t) => { const box = $('#near'); if (box) box.innerHTML = `<div class="msg">${esc(t)}</div>`; };
      if (!navigator.geolocation) return msg('这个浏览器不能定位，请直接打名字。');
      msg('定位中…');
      let pos;
      try { pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })); }
      catch (e) { return msg(e.code === 1 ? '没有定位权限：到浏览器设定允许这个网站使用位置，再按一次。' : '定位不到，换个地方再试，或直接打名字。'); }
      msg('找附近油站…（可能要十几秒）');
      try { nearList = await nearbyStations(pos.coords.latitude, pos.coords.longitude); }
      catch { return msg('查不到油站资料（网络不稳？），请直接打名字。'); }
      const box = $('#near'); if (!box) return;
      if (!nearList.length) return msg('附近 5 公里内没找到油站，请直接打名字。');
      box.innerHTML = `<div class="map nearmap" id="nearmap"></div>` + nearList.map((s, i) => `<button type="button" class="opt" data-pick="${i}"><span class="no">${i + 1}</span><span class="nm">${esc(s.name)}${i === 0 && s.d < 150 ? '<span class="tag">就在旁边</span>' : ''}${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</span><span class="d">${dist(s.d)}</span></button>`).join('');
      // 小地图：你的位置＋编号油站，点油站就选它
      loadLeaflet().then(() => {
        const el = $('#nearmap'); if (!el) return;
        if (nearMap) nearMap.remove();
        nearMap = L.map(el, { zoomControl: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(nearMap);
        const me = [pos.coords.latitude, pos.coords.longitude];
        const css = getComputedStyle(document.documentElement);
        L.circleMarker(me, { radius: 7, color: css.getPropertyValue('--surface').trim(), weight: 2, fillColor: css.getPropertyValue('--accent').trim(), fillOpacity: 1 }).addTo(nearMap);
        nearList.forEach((s, i) => L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="pin">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .on('click', () => pickStation(s)).addTo(nearMap));
        nearMap.fitBounds(L.latLngBounds([me, ...nearList.slice(0, 5).map((s) => [s.lat, s.lon])]), { padding: [24, 24], maxZoom: 17 });
      }).catch(() => { const el = $('#nearmap'); if (el) el.remove(); });
    };
    draw();
    sh.hidden = false; sheetOpen = true;
    history.pushState({ sheet: 1 }, '');
    if (!rec) setTimeout(() => sh.querySelector('[name=odo]')?.focus(), 50);
  }
  function closeSheet(fromPop) {
    if (!sheetOpen) return;
    sheetOpen = false; $('#sheet').hidden = true;
    if (!fromPop) history.back();
  }
  window.addEventListener('popstate', () => closeSheet(true));

  function upsert(rec) {
    rec.updatedAt = Date.now();
    const i = db.records.findIndex((r) => r.id === rec.id);
    if (i >= 0) db.records[i] = rec; else db.records.push(rec);
    db.dirty = true; editSeq++; saveDB(); render(); scheduleSync();
  }

  // ---------- CSV ----------
  const CSV_HEAD = ['日期', '里程(km)', '类别', '项目', '总额(MYR)', '公升', '单价(MYR/L)', '油耗(km/L)', '油站', '备注'];
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function importCSV(text) {
    const rows = parseCSV(text);
    const head = rows.shift() || [];
    const col = (name) => head.findIndex((h) => h.trim().startsWith(name));
    const c = { date: col('日期'), odo: col('里程'), type: col('类别'), item: col('项目'), total: col('总额'), liters: col('公升'), price: col('单价'), station: col('油站'), note: col('备注') };
    const get = (r, k) => (c[k] >= 0 ? (r[c[k]] || '').trim() : '');
    let added = 0, updated = 0, skipped = 0;
    const stamp = Date.now();
    for (const r of rows) {
      const date = get(r, 'date'), odo = num(get(r, 'odo')), total = num(get(r, 'total'));
      const type = get(r, 'type') === '服务' ? 'service' : 'fuel';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !odo || !total) { skipped++; continue; }
      const rec = { id: `imp-${date}-${Math.round(odo)}-${type[0]}`, type, date, odo: Math.round(odo), total, item: get(r, 'item'), note: get(r, 'note'), updatedAt: stamp };
      if (type === 'fuel') {
        let liters = num(get(r, 'liters')), price = num(get(r, 'price'));
        if (!liters && price) liters = total / price;
        if (!liters) { skipped++; continue; }
        rec.liters = liters; rec.price = price || Math.round((total / liters) * 100) / 100;
        if (!rec.item || rec.item === '中级汽油') rec.item = FUEL_NAME;
        const sn = get(r, 'station'); if (sn) rec.station = { name: sn };
      }
      const i = db.records.findIndex((x) => x.id === rec.id);
      if (i >= 0) { db.records[i] = rec; updated++; } else { db.records.push(rec); added++; }
    }
    db.dirty = true; editSeq++; saveDB(); render(); scheduleSync();
    return { added, updated, skipped };
  }
  function exportCSV() {
    const A = analyze();
    const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [CSV_HEAD.join(',')];
    for (const r of A.recs) {
      const i = A.info.get(r.id);
      lines.push([r.date, r.odo, r.type === 'fuel' ? '加油' : '服务', r.item || '', r.total.toFixed(2),
        r.type === 'fuel' ? r.liters : '', r.type === 'fuel' ? r.price.toFixed(2) : '',
        i && i.kmL != null ? i.kmL.toFixed(3) : '', r.station?.name || '', r.note || ''].map((v) => q(String(v))).join(','));
    }
    download(`打油记录_${today()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const payload = () => ({ app: 'fuel-log', version: 1, savedAt: new Date().toISOString(), meta: db.meta, records: [...db.records].sort((a, b) => (a.id < b.id ? -1 : 1)) });

  // ---------- GitHub 同步 ----------
  // 每笔记录带 updatedAt；两边各取较新的那份；删除留一个 deleted 记号，另一边才会跟着删。
  const sync = { state: 'off', msg: '', at: store.get('fuel-sync-at', 0) };
  const cfgReady = () => !!(cfg.owner && cfg.repo && cfg.token);

  function syncText(long) {
    if (!cfgReady()) return long ? '还没设置。设置好之后，每次保存都会自动备份到你的私有仓库。' : '未设置同步';
    const at = sync.at ? new Date(sync.at) : null;
    const when = at ? (isoDay(at) === today() ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : md(isoDay(at))) : '';
    if (sync.state === 'busy') return '同步中…';
    if (sync.state === 'err') return long ? `同步失败：${sync.msg}` : '同步失败';
    if (sync.state === 'offline' || db.dirty) return long ? `有改动还没上传${navigator.onLine ? '' : '（没有网络）'}，有网络时会自动上传。` : '待上传';
    return long ? `已同步到 ${cfg.owner}/${cfg.repo}${when ? '，' + when : ''}` : `已同步 ${when}`;
  }
  function renderSync() {
    const b = $('#sync');
    const cls = !cfgReady() ? '' : sync.state === 'busy' ? 'busy' : sync.state === 'err' ? 'err' : db.dirty ? '' : 'ok';
    b.className = 'sync ' + cls;
    b.innerHTML = `<i></i>${esc(syncText(false))}`;
    const st = document.getElementById('s-status');
    if (st) st.textContent = syncText(true);
  }

  const b64enc = (s) => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const apiURL = () => `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${(cfg.path || 'fuel.json').split('/').map(encodeURIComponent).join('/')}`;
  const headers = () => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28' });
  const httpMsg = (s) => ({ 401: '令牌无效或已过期', 403: '令牌权限不够（Contents 要开 Read and write）', 404: '找不到仓库，检查账号和仓库名称，或令牌没有选这个仓库' }[s] || `GitHub 回应 ${s}`);

  function merge(a, b) {
    const m = new Map();
    for (const r of [...a, ...b]) {
      const o = m.get(r.id);
      if (!o || (r.updatedAt || 0) > (o.updatedAt || 0)) m.set(r.id, r);
    }
    return [...m.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  const canon = (meta, recs) => JSON.stringify([meta || null, recs]);

  let syncRunning = null, syncAgain = false;
  async function doSync() {
    if (!cfgReady()) { sync.state = 'off'; renderSync(); return; }
    if (!navigator.onLine) { sync.state = 'offline'; renderSync(); return; }
    if (syncRunning) { syncAgain = true; return syncRunning; }
    sync.state = 'busy'; renderSync();
    syncRunning = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const seq = editSeq;
          const res = await fetch(apiURL(), { headers: headers(), cache: 'no-store' });
          let sha = null, remote = null;
          if (res.ok) { const j = await res.json(); sha = j.sha; remote = JSON.parse(b64dec(j.content)); }
          else if (res.status !== 404) throw new Error(httpMsg(res.status));
          const rRecs = remote && Array.isArray(remote.records) ? remote.records : [];
          const rMeta = remote && remote.meta;
          const recs = migrate(merge(db.records, rRecs));
          const meta = rMeta && (rMeta.updatedAt || 0) > (db.meta.updatedAt || 0) ? rMeta : db.meta;
          if (seq !== editSeq) continue; // 合并期间又改了，重来
          db.records = recs; db.meta = meta; saveDB();
          if (remote && canon(meta, recs) === canon(rMeta, merge([], rRecs))) {
            db.dirty = false; saveDB(); break;
          }
          const put = await fetch(apiURL(), {
            method: 'PUT', headers: headers(),
            body: JSON.stringify({ message: `更新打油记录 ${today()}`, content: b64enc(JSON.stringify(payload(), null, 1)), ...(sha ? { sha } : {}) }),
          });
          if (put.ok) { if (seq === editSeq) db.dirty = false; else syncAgain = true; saveDB(); break; }
          if (put.status === 409 || put.status === 422) continue; // 别处刚写过，重抓再合并
          throw new Error(put.status === 404 && !sha ? httpMsg(404) : httpMsg(put.status));
        }
        sync.state = 'ok'; sync.msg = ''; sync.at = Date.now(); store.set('fuel-sync-at', sync.at);
      } catch (e) {
        sync.state = 'err'; sync.msg = e instanceof TypeError ? `连不上 GitHub（${navigator.onLine ? '检查令牌有没有贴错，或关掉广告拦截／VPN' : '没有网络'}；${e.message}）` : e.message;
      } finally {
        syncRunning = null;
        if (sheetOpen || ui.tab === 'map') renderSync(); else render();
        if (syncAgain) { syncAgain = false; setTimeout(doSync, 300); }
      }
    })();
    return syncRunning;
  }
  let syncTimer = null;
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 800); }

  // ---------- 事件 ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sheet')) return;
    const t = e.target.closest('[data-tab],[data-act],[data-id],[data-range],[data-stn]');
    if (!t) return;
    if (t.dataset.tab) { ui.tab = t.dataset.tab; saveUI(); render(); window.scrollTo(0, 0); return; }
    if (t.dataset.range) { ui.range = t.dataset.range; saveUI(); render(); return; }
    if (t.dataset.stn != null) {
      const m = mapMarks[+t.dataset.stn];
      if (m && mapObj) { mapObj.setView(m.getLatLng(), 16); m.openPopup(); $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
    if (t.dataset.id) { const r = db.records.find((x) => x.id === t.dataset.id); if (r) openSheet(r); return; }
    switch (t.dataset.act) {
      case 'add': openSheet(null, 'fuel'); break;
      case 'sync':
        if (cfgReady()) doSync(); else { ui.tab = 'set'; saveUI(); render(); }
        break;
      case 'savecfg':
        cfg = { owner: $('#s-owner').value.replace(/ /g, '').trim(), repo: $('#s-repo').value.replace(/ /g, '').trim(), path: $('#s-path').value.trim() || 'fuel.json', token: $('#s-token').value.replace(/[^!-~]/g, '') };
        store.set(LS.cfg, cfg);
        if (!cfgReady()) { toast('账号、仓库、令牌三项都要填'); renderSync(); break; }
        doSync().then(() => toast(sync.state === 'ok' ? '同步好了' : syncText(true)));
        break;
      case 'clearcfg':
        if (confirm('清除这部手机上的令牌？（记录不会删）')) { cfg.token = ''; store.set(LS.cfg, cfg); sync.state = 'off'; render(); }
        break;
      case 'importcsv': $('#f-csv').click(); break;
      case 'importjson': $('#f-json').click(); break;
      case 'exportcsv': exportCSV(); break;
      case 'exportjson': download(`打油记录备份_${today()}.json`, JSON.stringify(payload(), null, 1), 'application/json'); break;
    }
  });

  let lastFocusSync = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFocusSync > 60000) { lastFocusSync = Date.now(); doSync(); }
  });
  window.addEventListener('online', () => doSync());
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (ui.tab === 'stats') drawCharts(); }, 150); });

  render();
  lastFocusSync = Date.now();
  doSync();

  // 测试用
  window.FuelApp = { importCSV, doSync, analyze, get db() { return db; } };
})();
