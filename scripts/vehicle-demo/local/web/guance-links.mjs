// Stable job identities for the vehicle namespace; never derive IDs from a run UUID.
let workspace = '';
export function configureGuanceLinks(value) {
  workspace = typeof value === 'string' && /^wksp_[A-Za-z0-9]+$/.test(value) ? value : '';
}
const jobs = {
  emqx_telemetry_to_kafka: '6d7167fa182c72affa7319dcc7be218cb81714491cd12ce0e3507602816ee825',
  vehicle_clean_and_detect: '94ad7c0a5c8ea7ff3841062217ad9b8df48a9323f25416264009d6a2d425d075',
  vehicle_summary: 'a2dfbd53f359945cae03e3f57fa2faf53affdbc726ea6c2ea4d69df1a040844d',
};
export function guanceJobUrl(jobName = 'vehicle_summary', runId = null) {
  const url = new URL('https://console.guance.com/data-observability/jobs');
  if (workspace) url.searchParams.set('w', workspace);
  url.searchParams.set('time', '1d');
  if (jobs[jobName]) {
    url.searchParams.set('job', jobs[jobName]);
    url.searchParams.set('jobTab', 'runs');
    if (typeof runId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId)) url.searchParams.set('run', runId);
  }
  return url.href;
}

export function operationRuns(operation, fallbackJob) {
  const runs = [], active = !['idle', 'recovered'].includes(operation.phase);
  const job = {flink_pause: 'vehicle_clean_and_detect', spark_fail: 'vehicle_summary',
    emqx_backlog: 'emqx_telemetry_to_kafka'}[operation.scenario] || fallbackJob;
  if (operation.failedRun) runs.push(['失败运行', operation.failedRun.runId, operation.failedRun.job || job || 'vehicle_summary']);
  else if (active) {
    const affected = operation.affectedRuns?.find(run => run.job === job);
    if (affected) runs.push(['注入前最近运行', affected.runId, affected.job]);
  }
  const recovery = operation.flinkRecoveryRun || operation.recoveryRun;
  if (recovery) runs.push(['恢复运行', recovery.runId, recovery.job || 'vehicle_summary']);
  return runs;
}
