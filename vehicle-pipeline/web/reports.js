'use strict';
const $ = id => document.getElementById(id);
const number = value => new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1}).format(Number(value));
const time = value => value ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false}) : '—';
const text = (id, value) => { $(id).textContent = value; };
const names = {emqx_telemetry_to_kafka: 'EMQX · 消息转发', vehicle_clean_and_detect: 'Flink · 清洗与检测', vehicle_summary: 'Spark · 统计汇总'};
function render(data) {
  text('updated', '更新于 ' + time(data.generatedAt));
  const jobs = document.createDocumentFragment();
  for (const name of Object.keys(names)) {
    const job = data.jobs.find(item => item.job_name === name);
    const element = document.createElement('article'); element.className = 'job';
    const heading = document.createElement('strong'); heading.textContent = names[name];
    const badge = document.createElement('span'); badge.className = 'status';
    const component = data.components.find(item => item.component === (name.startsWith('emqx') ? 'emqx' : 'flink'));
    const stale = name !== 'vehicle_summary' && (!component || Date.now() - new Date(component.last_seen_at).getTime() > 90000);
    const rawState = job?.metadata?.engineState || job?.state;
    const states = {START: '启动中', RUNNING: '运行中', COMPLETE: '成功', FAIL: '失败', ABORT: '已中止', RESTARTING: '恢复中', INITIALIZING: '初始化', CREATED: '准备中'};
    const brokerUnavailable = name.startsWith('emqx') && job?.metadata?.status !== 'connected';
    badge.textContent = stale ? '状态待更新' : brokerUnavailable ? '连接待恢复' : (states[rawState] || rawState || '尚未执行');
    if (stale || brokerUnavailable || ['FAIL','ABORT','RESTARTING'].includes(rawState)) badge.classList.add('warn');
    const detail = document.createElement('p');
    detail.textContent = job ? '输入 ' + (job.input_count == null ? '—' : number(job.input_count)) + ' · 输出 ' + (job.output_count == null ? '—' : number(job.output_count)) + (job.error_code ? ' · ' + job.error_code : '') : '等待引擎运行';
    element.append(heading, badge, detail); jobs.append(element);
  }
  $('jobs').replaceChildren(jobs);
  if (!data.batch) { text('notice', '尚无成功报表，正在等待第一批已提交数据。'); return; }
  $('report').hidden = false;
  const b = data.batch;
  const failed = data.jobs.some(job => job.job_name === 'vehicle_summary' && ['FAIL', 'ABORT'].includes(job.state));
  $('notice').className = b.stale || failed ? 'warn' : '';
  text('notice', b.stale ? '源数据超过 15 分钟未更新，当前保留最近一次成功结果。' : failed ? '最近一次汇总未成功，当前显示上一批成功结果。' : '数据已更新 · 报表与本批次 Run ID 一致');
  text('freshness', '源数据距今 ' + number(b.ageSeconds) + ' 秒');
  text('samples', number(b.unique_rows));
  text('distance', number(data.days.reduce((sum, row) => sum + Number(row.distance_km), 0)) + ' km');
  text('temperature', number(Math.max(...data.days.map(row => Number(row.max_temp_c)))) + ' °C');
  text('anomalies', number(data.days.reduce((sum, row) => sum + Number(row.high_temp_samples), 0)));
  const rows = document.createDocumentFragment();
  for (const row of data.days) {
    const tr = document.createElement('tr');
    for (const value of [row.day, number(row.sample_count), number(row.avg_speed_kph) + ' km/h', number(row.distance_km) + ' km', number(row.min_soc_pct) + '%', number(row.max_temp_c) + ' °C', number(row.high_temp_samples), number(row.charge_samples)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    rows.append(tr);
  }
  $('days').replaceChildren(rows);
  for (const [id, value] of Object.entries({'run-id': b.run_id, snapshot: b.snapshot_hash, objects: b.object_count, 'last-event': time(b.last_event_ms), pending: data.lineagePending})) text(id, value);
  draw(data.windows);
}
function draw(windows) {
  const chart = $('chart'), NS = 'http://www.w3.org/2000/svg';
  chart.replaceChildren();
  const ceiling = Math.max(20, ...windows.map(w => Number(w.avg_speed_kph)));
  for (let row = 0; row < 4; row++) {
    const line = document.createElementNS(NS, 'line');
    for (const [key, value] of Object.entries({x1: 0, x2: 1000, y1: 12 + row * 50, y2: 12 + row * 50, stroke: '#263743'})) line.setAttribute(key, value);
    chart.append(line);
  }
  if (!windows.length) return;
  const points = windows.map((row, i) => [windows.length === 1 ? 500 : i / (windows.length - 1) * 990 + 5, 162 - Number(row.avg_speed_kph) / ceiling * 145]);
  const path = document.createElementNS(NS, 'polyline');
  path.setAttribute('points', points.map(p => p.join(',')).join(' ')); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#64e3bb'); path.setAttribute('stroke-width', '3'); chart.append(path);
  for (const [x, y] of points) { const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', '3'); dot.setAttribute('fill', '#64e3bb'); chart.append(dot); }
  text('chart-start', time(windows[0].bucket_start)); text('chart-end', time(windows[windows.length - 1].bucket_start));
}
let controller, timer;
async function refresh() {
  clearTimeout(timer); controller?.abort();
  if (document.hidden) return;
  controller = new AbortController();
  const current = controller;
  const timeout = setTimeout(() => current.abort(), 10000);
  try {
    const response = await fetch('/vehicle-demo/api/report', {signal: current.signal, cache: 'no-store'});
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (controller === current) render(data);
  } catch (error) {
    if (controller === current && !document.hidden) { text('notice', '暂时无法读取报表，保留已显示的数据；稍后自动重试。'); $('notice').className = 'warn'; }
  } finally {
    clearTimeout(timeout);
    if (controller === current && !document.hidden) timer = setTimeout(refresh, 20000);
  }
}
document.addEventListener('visibilitychange', refresh);
refresh();
