import {reportView, speedBuckets, liveView, reportFreshness} from './report-model.mjs';
import {configureGuanceLinks, guanceJobUrl, operationRuns} from './guance-links.mjs';
import {startPlayerConnection} from './player-connection.mjs';
const $ = id => document.getElementById(id);
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1}).format(Number(value));
const when = value => value ? new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false}) : '—';
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
const states = {START: '启动中', RUNNING: '运行中', COMPLETE: '成功', FINISHED: '成功', FAIL: '失败', FAILED: '失败', ABORT: '已中止', CANCELED: '已中止', RESTARTING: '恢复中', INITIALIZING: '初始化', CREATED: '准备中'};
const names = {emqx_telemetry_to_kafka: 'EMQX · 消息转发', vehicle_clean_and_detect: 'Flink · 清洗与检测', vehicle_summary: 'Spark · 统计汇总'};
const errors = {
  PLAYER_CONFIG_UNAVAILABLE: '尚未配置车机播放器，请准备播放器文件与连接配置。',
  PLAYER_CONFIG_INVALID: '车机连接配置无效，请核对车机连接地址。',
  PLAYER_ASSETS_MISSING: '缺少车机播放器文件，请构建或恢复已验证的播放器。',
  KUBE_CONFIG_MISSING: '未配置集群访问凭据，请检查后端 kubeconfig 挂载。',
  KUBE_CONTEXT_REQUIRED: '尚未指定目标集群，请配置后端的 Kubernetes context。',
  KUBE_CONFIG_INVALID: '集群访问配置无效，请检查后端 kubeconfig 和所选 context。',
  KUBE_CLIENT_MISSING: '后端缺少 Kubernetes 客户端，请重新构建服务镜像。',
  KUBE_NETWORK_UNAVAILABLE: '无法连接 Kubernetes API，请检查后端到集群的网络。',
  KUBE_TLS_REQUIRED: '集群 API 必须使用 HTTPS 并启用证书校验。',
  KUBE_TLS_FAILED: '集群 API 证书校验失败，请更新有效的 kubeconfig。',
  KUBE_UNAUTHORIZED: '集群凭据无效或已过期，请检查后端凭据与 ServiceAccount。',
  KUBE_FORBIDDEN: '已连接 Kubernetes API，但当前身份缺少车机命名空间的操作权限。',
  KUBE_EXECUTOR_NOT_CONFIGURED: '尚未配置集群恢复执行器，请初始化专用 ServiceAccount 和状态配置。',
  KUBE_WORKER_FORBIDDEN: '集群恢复执行器权限不足，故障未开始或正在等待原配置还原。',
  EMQX_EXECUTOR_NOT_CONFIGURED: '尚未配置当前 EMQX 节点的专用故障执行权限，请更新执行器配置。',
  EMQX_TARGET_NOT_READY: 'EMQX 节点或版本不符合演练要求，暂不能注入。',
  EMQX_EXEC_UNAVAILABLE: '暂时无法连接 EMQX 故障执行器，内部自动恢复保护仍保留。',
  EMQX_GATE_CONTRACT_FAILED: 'EMQX 发送状态校验未通过，未确认操作成功，请核对执行器。',
  EMQX_BACKLOG_NOT_OBSERVED: '发送设置已还原，但本次未观测到实际积压，请确认车机持续上报。',
  KUBE_RESOURCE_MISSING: '目标集群缺少所需车机资源，请核对 context 和现有数据链路。',
  KUBE_CONFLICT: '操作状态已更新，请刷新后重试。',
  KUBE_API_UNAVAILABLE: 'Kubernetes API 暂不可用，请稍后重试。',
  KUBE_CONTROL_UNAVAILABLE: '控制服务暂不可用，请检查集群连接和后端配置。',
  CONTROL_BUSY_RETRY: '控制请求正在处理，请稍后重试。',
  OPERATION_ALREADY_ACTIVE: '已有故障操作，请先恢复。',
  FRESH_SUCCESSFUL_REPORT_REQUIRED: '当前没有新鲜的成功报表，先恢复数据链路后再注入。',
  SPARK_BUSY_RETRY_AFTER_CURRENT_RUN: '当前汇总正在执行，请等待本批次结束再注入。',
  FRESH_COMPONENT_STATE_REQUIRED: '组件观测状态已过期，暂不能注入。',
  FLINK_EXECUTION_NOT_READY: 'Flink 执行与检查点尚未就绪，请等待恢复后再注入。',
  FLINK_FAILURE_NOT_OBSERVED: '未确认本次 Flink 失败记录，资源已还原，请查看引擎与上报状态。',
  UPSTREAM_ALREADY_UNHEALTHY: '上游连接或积压尚未恢复，暂不能注入。',
  TARGET_NOT_READY: '目标处理组件未就绪，暂不能注入。',
  RESOURCE_CHANGED_EXTERNALLY: '资源被其他操作修改，请核对原配置后恢复。',
  RESOURCE_REPLACED: '目标资源已被替换，请核对后恢复。',
  BROKER_DROP_INCREASED_REQUIRES_RECONCILIATION: '检测到消息丢弃计数增加，需要核对数据；未标记恢复成功。',
  NO_NEW_SOURCE_DATA: '尚未看到新的源数据，请确认车机正在上报，再重试恢复。',
  RECOVERY_SUMMARY_FAILED: '恢复汇总未成功，可查看运行记录后重试恢复。',
  RECOVERY_DATA_TIMEOUT: '等待数据恢复超时，已尝试还原运行配置。',
  RUN_RESULT_UNAVAILABLE: '未读取到作业终态与 Run ID，请查看观测云及引擎记录。',
};
function errorMessage(error) { return errors[error.message] || `连接暂不可用（${error.message || 'NETWORK_UNAVAILABLE'}）`; }
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.long ? 95000 : 15000);
  try {
    const response = await fetch(path, {...options, signal: controller.signal, cache: 'no-store'});
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || `HTTP_${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}
function notice(id, message, tone = '') {
  const element = $(id);
  if (!element) return;
  if (element.textContent !== message) element.textContent = message;
  if (id === 'report-notice') $('report-notice-wrap').className = 'report-notice ' + tone;
  else element.className = 'fault-current ' + tone;
}
function poll(task, interval) {
  let timer, running = false, stopped = false;
  async function tick() {
    clearTimeout(timer);
    if (stopped || document.hidden || running) return;
    running = true;
    try { await task(); } finally {
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(tick, interval);
    }
  }
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  window.addEventListener('pageshow', () => { stopped = false; tick(); });
  tick();
  return tick;
}

let reportData, reportUnavailable = false, liveData, liveUnavailable = false;
const modeNames = {DRIVE: '行驶', PARK: '停车', CHARGE: '充电'};
function renderLive() {
  const view = liveView(liveData, $('vehicle-search').value, $('vehicle-status').value, Date.now(), liveUnavailable);
  for (const [id, key] of [['seen', 'seenToday'], ['vehicle-report-active', 'reporting'], ['vehicle-report-missing', 'silent'], ['vehicle-report-received', 'receivedLastMinute']]) text(id, number(view.totals[key]));
  text('live-notice', view.healthy ? `接收状态更新于 ${when(liveData.generatedAt)} · 每 5 秒刷新`
    : liveData ? '实时接收状态暂不可用，以下保留最近已知记录；正在重试。' : liveUnavailable ? '实时接收数据暂不可用，正在重试。' : '正在读取实时接收记录…');
  $('live-notice').classList.toggle('live-unavailable', !view.healthy);
  const bar = $('vehicle-mode-bar'); bar.replaceChildren();
  const total = Object.values(view.modes).reduce((sum, count) => sum + (count || 0), 0);
  for (const mode of Object.keys(modeNames)) {
    const count = view.modes[mode], css = 'mode-' + mode.toLowerCase();
    text('count-' + mode.toLowerCase(), count == null ? '—' : `${number(count)} 辆`);
    if (count > 0 && total > 0) {
      const segment = document.createElement('span'); segment.className = css;
      segment.style.width = `${count / total * 100}%`; bar.append(segment);
    }
  }
  const dayCounts = new Map(reportData?.batch ? reportView(reportData).vehicles : []);
  tableRows('vehicle-report-rows', view.vehicles.map(row => {
    const age = Number.isFinite(row.lastReceivedAt) ? Math.max(0, Math.floor((Date.now() - row.lastReceivedAt) / 1000)) : null;
    const received = age == null ? '—' : age < 60 ? `${age} 秒前` : age < 3600 ? `${Math.floor(age / 60)} 分钟前` : when(row.lastReceivedAt);
    return [row.vehicleId, {reporting: '近 1 分钟有上报', silent: '超过 1 分钟未上报', waiting: '等待首次上报', unknown: '状态待确认'}[row.status],
      received, modeNames[row.mode] || '—', row.batterySocPct == null ? '—' : `${number(row.batterySocPct)}%`,
      row.batteryTempC == null ? '—' : `${number(row.batteryTempC)} °C`, dayCounts.has(row.vehicleId) ? number(dayCounts.get(row.vehicleId)) : '—'];
  }), liveData ? '没有符合筛选条件的车辆。' : liveUnavailable ? '暂时无法读取车辆接收记录。' : '正在读取车辆接收记录…', 7);
  text('vehicle-report-count', `显示 ${view.vehicles.length} / ${view.total} 辆 · 场景、电量和温度为最近采样值，未上报时保留最后状态；今日汇总样本来自成功报表。`);
}
function tableRows(id, rows, empty, columns) {
  const fragment = document.createDocumentFragment();
  for (const values of rows) {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    fragment.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = columns; td.textContent = empty; tr.append(td); fragment.append(tr); }
  $(id).replaceChildren(fragment);
}
function renderReport(data) {
  reportData = data;
  const view = reportView(data, $('vehicle-search').value);
  for (const id of ['samples', 'distance', 'temperature', 'anomalies']) text(id, view.hasToday ? number(view[id]) : '—');
  renderLive();
  tableRows('report-rows', view.days.map(row => [row.day, row.vehicle_id, number(row.sample_count), number(row.distance_km), number(row.min_soc_pct), number(row.max_temp_c), number(row.high_temp_samples), number(row.charge_samples)]), data.batch ? '该时间范围或筛选条件下暂无成功汇总数据。' : '等待首个成功批次。', 8);
  const failed = (data.jobs || []).some(job => job.job_name === 'vehicle_summary' && ['FAIL', 'ABORT'].includes(job.state));
  notice('report-notice', !data.batch ? '尚无成功报表' : !view.hasToday ? '等待今日首个成功汇总，以下保留最近批次时间' : data.batch.stale ? '历史报表覆盖的数据已超过 15 分钟，保留最近成功批次' : failed ? '最近汇总未成功，显示上一成功批次' : '今日统计 · 同一成功批次', data.batch?.stale || failed ? 'warn' : '');
  if (reportUnavailable) notice('report-notice', '连接暂不可用，当前为上次收到的数据', 'error');
  text('snapshot-time', data.batch ? `汇总于 ${when(data.batch.generated_at)} · 数据截至 ${when(data.batch.last_event_ms)}` : '等待成功批次');
  text('history-title', '今日运行统计');
  text('report-batch-label', '成功批次 · 已去重样本');
  text('batch-id', data.batch?.run_id || '—'); text('batch-time', when(data.batch?.generated_at));
  drawChart(view.windows);
}
function drawChart(windows) {
  const values = speedBuckets(windows), chart = $('speed-chart'); chart.replaceChildren(); $('chart-axis').replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  function element(tag, attributes, content) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (content != null) node.textContent = content;
    chart.append(node); return node;
  }
  const ceiling = Math.max(20, Math.ceil(Math.max(0, ...values.map(v => v.speed)) / 20) * 20);
  for (let i = 0; i < 4; i++) {
    const y = 12 + i * 46;
    element('line', {x1: 30, x2: 770, y1: y, y2: y, stroke: '#edf1f6', 'stroke-width': 1});
    element('text', {x: 22, y: y + 3, 'text-anchor': 'end'}, number(ceiling * (3 - i) / 3));
  }
  if (!values.length) { element('text', {x: 400, y: 85, 'text-anchor': 'middle'}, '暂无窗口数据'); text('chart-range', '当前范围暂无已发布的速度窗口'); return; }
  const first = Date.parse(values[0].at), last = Date.parse(values.at(-1).at);
  const points = values.map(v => [first === last ? 400 : 30 + (Date.parse(v.at) - first) / (last - first) * 740, 150 - v.speed / ceiling * 138]);
  element('polygon', {points: [[points[0][0], 150], ...points, [points.at(-1)[0], 150]].map(p => p.join(',')).join(' '), class: 'chart-area'});
  element('polyline', {points: points.map(p => p.join(',')).join(' '), fill: 'none', class: 'chart-line'});
  for (const [x, y] of points) element('circle', {cx: x, cy: y, r: 2, fill: '#8aacd4', stroke: 'none'});
  const ticks = first === last ? [first] : Array.from({length: 5}, (_, i) => first + (last - first) * i / 4);
  for (const tick of ticks) { const span = document.createElement('span'); span.textContent = new Date(tick).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}); $('chart-axis').append(span); }
  text('chart-range', `${values.length} 个实际窗口 · 按样本数加权 · 北京时间`);
}
function initPipeline() {
  const nodes = [
  {id: 'android', name: 'Android', abbr: 'APP', detail: '每秒遥测', description: 'Android 车机每秒产生速度、电量、温度和里程；每条事件保留唯一 ID。'},
  {id: 'emqx', name: 'EMQX', abbr: 'MQ', detail: '消息接入', description: 'EMQX 接收 MQTT 消息，经 Kafka Sink 转发。Broker 确认代表消息已接收，下游处理状态需继续查看。'},
  {id: 'kafka', name: 'Kafka', abbr: 'K', detail: '持久消息', description: 'Kafka 持久保存原始遥测，为 Flink 提供连续、可恢复的输入。'},
  {id: 'flink', name: 'Flink', abbr: 'FL', detail: '清洗 · 检测', description: 'Flink 校验数据、按事件 ID 去重，识别高温与低电量，检查点完成后提交 Parquet。'},
  {id: 'lake', name: 'Parquet', abbr: 'S3', detail: '数据沉淀', description: '已提交数据保存为 Parquet，分为 clean、anomalies 和 quarantine；异常样本属于清洗数据的子集。'},
  {id: 'spark', name: 'Spark SQL', abbr: 'SP', detail: '统计汇总', description: 'Spark SQL 读取固定输入快照，将五分钟趋势和每日汇总写入 MySQL，同批次报表共享 Run ID。'}
];
  for (const node of nodes) {
    const button = document.createElement('button'); button.className = 'pipeline-node'; button.setAttribute('aria-pressed', 'false');
    for (const [tag, className, value] of [['span', 'node-abbr', node.abbr], ['strong', '', node.name], ['small', '', node.detail]]) {
      const element = document.createElement(tag); element.className = className; element.textContent = value; button.append(element);
    }
    button.addEventListener('click', () => {
      for (const sibling of $('pipeline').children) sibling.setAttribute('aria-pressed', String(sibling === button));
      text('pipeline-description', node.description);
    });
    $('pipeline').append(button);
  }
  $('pipeline').firstElementChild.click();
}

async function initScene() {
  initPipeline();
  const player = startPlayerConnection({window, document, frame: $('player'), button: $('reconnect'),
    status: $('player-status'), loadPlayer: () => api('/api/vehicle/player'), describeError: errorMessage});
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function selectTab(tab, focus = false) {
    tabs.forEach(item => { const active = item === tab; item.setAttribute('aria-selected', active); item.tabIndex = active ? 0 : -1; $(item.dataset.view).hidden = !active; });
    player.setActive(tab.dataset.view === 'car');
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length], true);
    });
  });
  $('vehicle-search').addEventListener('input', () => { if (reportData) renderReport(reportData); else renderLive(); });
  $('vehicle-status').addEventListener('change', renderLive);
  poll(async () => {
    try { liveData = await api('/vehicle-demo/api/live'); liveUnavailable = false; }
    catch { liveUnavailable = true; }
    renderLive();
  }, 5000);
  const liveClock = window.setInterval(() => { if (!document.hidden) renderLive(); }, 1000);
  window.addEventListener('pagehide', () => window.clearInterval(liveClock), {once: true});
  poll(async () => {
    try { const data = await api('/vehicle-demo/api/report'); reportUnavailable = false; renderReport(data); }
    catch { reportUnavailable = true; notice('report-notice', '暂时无法读取报表，保留上次数据；稍后自动重试。', 'error'); }
  }, 20000);
}

function renderJobs(data) {
  reportData = data;
  text('jobs-notice', '更新于 ' + when(data.generatedAt));
  const expanded = new Set([...$('jobs').querySelectorAll('details[open]')].map(item => item.dataset.job));
  const fragment = document.createDocumentFragment();
  for (const [key, label] of Object.entries(names)) {
    const job = (data.jobs || []).find(item => item.job_name === key);
    const componentName = key.startsWith('emqx') ? 'emqx' : 'flink';
    const component = (data.components || []).find(item => item.component === componentName);
    const stale = key !== 'vehicle_summary' && (!component || Date.now() - new Date(component.last_seen_at).getTime() > 90000);
    const raw = job?.metadata?.engineState || job?.state;
    const brokerStatus = key.startsWith('emqx') ? job?.metadata?.status : null;
    const warning = stale || ['FAIL', 'ABORT', 'RESTARTING', 'FAILED', 'CANCELED'].includes(raw) || (brokerStatus && brokerStatus !== 'connected');
    const item = document.createElement('details'); item.className = 'job'; item.dataset.job = key; item.open = expanded.has(key);
    const summary = document.createElement('summary'), engine = document.createElement('span'), heading = document.createElement('span'), title = document.createElement('strong'), code = document.createElement('small'), badge = document.createElement('span');
    engine.className = 'job-engine'; engine.textContent = key.startsWith('emqx') ? 'MQ' : key === 'vehicle_summary' ? 'SP' : 'FL';
    heading.className = 'job-text'; title.textContent = label; code.textContent = key; code.title = key;
    badge.className = 'badge ' + (warning ? 'warn' : ['COMPLETE', 'FINISHED'].includes(raw) ? 'green' : 'blue');
    badge.textContent = stale ? '待更新' : states[raw] || raw || '暂无运行';
    heading.append(title, code); summary.append(engine, heading, badge);
    const detail = document.createElement('p');
    detail.textContent = `输入 ${number(job?.input_count)} · 输出 ${number(job?.output_count)}` + (brokerStatus ? ` · ${brokerStatus}` : '') + (job?.error_code ? ` · ${job.error_code}` : '');
    const id = document.createElement('code'); id.textContent = job?.run_id || '暂无 Run ID';
    item.append(summary, detail, id);
    if (job?.run_id) {
      const link = document.createElement('a'); link.className = 'link-button'; link.textContent = '查看本次运行 ↗';
      link.href = guanceJobUrl(key, job.run_id); link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
    }
    fragment.append(item);
  }
  $('jobs').replaceChildren(fragment);
  const emqx = (data.components || []).find(item => item.component === 'emqx');
  const emqxFresh = emqx && Date.now() - new Date(emqx.last_seen_at).getTime() <= 90000;
  text('fault-pending', emqxFresh ? number(emqx.payload?.queuing) : '—');
  renderFreshness();
  text('source-event-time', when(data.batch?.last_event_ms));
  text('last-success', when(data.batch?.generated_at)); text('lineage-pending', number(data.lineagePending));
}

function renderFreshness() {
  const {ageSeconds: age, stale} = reportFreshness(reportData);
  $('freshness').replaceChildren();
  if (age == null) text('freshness', '—');
  else for (const [value, unit] of [[Math.floor(age / 60), '分'], [Math.floor(age % 60), '秒']]) { const span = document.createElement('span'); span.textContent = unit; $('freshness').append(document.createTextNode(String(value)), span); }
  const unknown = reportUnavailable || (reportData?.batch && age == null);
  text('freshness-state', unknown ? '待更新' : !reportData?.batch ? '暂无批次' : stale ? '过时' : '新鲜');
  $('freshness-state').className = 'badge ' + (unknown || stale ? 'warn' : reportData?.batch ? 'green' : '');
}

async function initControls() {
  let config, operation = {phase: 'idle'}, busy = false, connected = false, requestId = crypto.randomUUID(), generation = 0;
  function selected() { return config?.catalog.find(item => item.id === $('scenario').value); }
  function renderOperation() {
    const active = !['idle', 'recovered'].includes(operation.phase), scenario = selected();
    $('scenario').disabled = busy || active || !config;
    $('inject').disabled = busy || active || !connected || !config;
    $('recover').disabled = busy || !connected || !operation.id || ['idle', 'recovered'].includes(operation.phase);
    text('description', scenario?.description || ''); text('expected', scenario?.expected || '');
    text('fault-job-name', scenario?.job || '—'); text('fault-ttl', scenario ? `故障开始后最长 ${scenario.ttl} 秒自动恢复。${scenario.id === 'spark_fail' ? '汇总运行中可排队，等待期间可取消。' : '按实际 Run ID 查看记录。'}` : '');
    $('guance-job-link').href = guanceJobUrl(scenario?.job);
    text('fault-produced', number(operation.after?.rows));
    const status = {idle: '尚未注入故障', waiting: '请求已排队，等待当前汇总结束；尚未注入故障…', injecting: '正在执行故障操作…', active: '故障已启用，实际运行状态见下方', recovering: '恢复中，等待检查点和新报表产出…', recovered: operation.outcome === 'cancelled' ? '等待已取消，未执行故障' : '数据已恢复，新成功批次已发布', error: errorMessage(new Error(operation.error))};
    if (connected) notice('operation-status', status[operation.phase] || '读取状态中…', operation.phase === 'error' ? 'error' : active ? 'warn' : '');
    text('recover', operation.phase === 'waiting' ? '取消等待' : '恢复');
    text('deadline', operation.phase === 'waiting' ? `最晚等待至：${when(operation.waitDeadline * 1000)}` : active && operation.deadline ? `保护恢复时间：${when(operation.deadline * 1000)}${operation.restored ? ' · 运行配置已还原' : ''}` : '');
    const runs = operationRuns(operation, scenario?.job);
    const links = document.createDocumentFragment();
    for (const [label, runId, jobName] of runs) {
      const div = document.createElement('div'), span = document.createElement('a'), code = document.createElement('code'), copy = document.createElement('button');
      div.className = 'run'; span.textContent = label; code.textContent = runId; copy.textContent = '复制 Run ID';
      span.href = guanceJobUrl(jobName, runId); span.target = '_blank'; span.rel = 'noopener noreferrer';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(runId); copy.textContent = '已复制'; } catch { copy.textContent = '请选择上方 Run ID 复制'; } });
      div.append(span, code, copy); links.append(div);
    }
    $('run-links').replaceChildren(links);
  }
  function applyOperation(next) {
    if (next.phase === 'recovered' && operation.phase !== 'recovered') requestId = crypto.randomUUID();
    operation = next;
    if (next.scenario && !['idle', 'recovered'].includes(next.phase)) $('scenario').value = next.scenario;
    renderOperation();
  }
  async function refreshOperation() {
    if (busy || !config) return;
    const current = generation;
    try { const data = await api('/api/vehicle/faults', {long: true}); if (current !== generation) return; connected = true; applyOperation(data.operation); }
    catch (error) { if (current !== generation) return; connected = false; renderOperation(); notice('operation-status', errorMessage(error), 'error'); }
  }
  async function act(action) {
    if (busy || !connected) return;
    busy = true; generation++; renderOperation(); notice('operation-status', action === 'inject' ? '正在提交故障操作…' : '正在请求恢复…');
    try {
      config = await api('/api/vehicle/config'); // A restarted backend issues a new same-origin token.
      const body = action === 'inject' ? {scenario: $('scenario').value, requestId} : {operationId: operation.id};
      const result = await api(`/api/vehicle/faults/${action}`, {method: 'POST', long: true, headers: {'Content-Type': 'application/json', 'X-Vehicle-Token': config.token}, body: JSON.stringify(body)});
      applyOperation(result.operation);
    } catch (error) { notice('operation-status', errorMessage(error), 'error'); }
    finally { busy = false; $('inject').disabled = !connected || !['idle', 'recovered'].includes(operation.phase); $('recover').disabled = !connected || !operation.id || ['idle', 'recovered'].includes(operation.phase); $('scenario').disabled = !['idle', 'recovered'].includes(operation.phase); }
  }
  $('scenario').addEventListener('change', renderOperation);
  $('inject').addEventListener('click', () => act('inject'));
  $('recover').addEventListener('click', () => act('recover'));
  // Update elapsed source age without making a request or rebuilding the job/fault controls.
  poll(renderFreshness, 1000);
  poll(async () => {
    try { const data = await api('/vehicle-demo/api/report'); reportUnavailable = false; renderJobs(data); }
    catch { reportUnavailable = true; text('jobs-notice', '读取失败，以下为上次收到的数据，状态待更新。'); renderFreshness(); }
  }, 20000);
  poll(async () => {
    try {
      if (!config) {
        config = await api('/api/vehicle/config');
        configureGuanceLinks(config.guanceWorkspace);
        $('scenario').replaceChildren(...config.catalog.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; return option; }));
        renderOperation();
      }
      await refreshOperation();
    } catch (error) { connected = false; notice('operation-status', errorMessage(error), 'error'); }
  }, 5000);
}

if (document.body.dataset.panel === 'scene') initScene();
else initControls();
