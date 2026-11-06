// Historical aggregates and live MQTT receipt snapshots have separate clocks.
export function reportFreshness(data, now = Date.now()) {
  const sourceTime = Number(data?.batch?.last_event_ms);
  const ageSeconds = Number.isFinite(sourceTime) && sourceTime > 0 && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - sourceTime) / 1000)) : null;
  return {ageSeconds, stale: ageSeconds == null ? null : ageSeconds > 900};
}

export function liveView(data, query = '', status = 'all', now = Date.now(), unavailable = false) {
  const age = now - Date.parse(data?.generatedAt);
  const healthy = !unavailable && data?.schemaVersion === 1 && data.source?.connected === true
    && Number.isFinite(age) && age >= -5000 && age <= 15000;
  const count = value => healthy && Number.isInteger(value) && value >= 0 ? value : null;
  const term = query.trim().toLowerCase();
  const all = (Array.isArray(data?.vehicles) ? data.vehicles : [])
    .filter(row => typeof row.vehicleId === 'string')
    .map(row => ({...row, status: healthy && ['reporting', 'silent', 'waiting'].includes(row.status) ? row.status : 'unknown',
      stateFresh: healthy && row.stateFresh === true}));
  return {healthy, total: all.length,
    totals: Object.fromEntries(['seenToday', 'reporting', 'silent', 'receivedLastMinute'].map(key => [key, count(data?.totals?.[key])])),
    modes: Object.fromEntries(['DRIVE', 'PARK', 'CHARGE'].map(key => [key, count(data?.modes?.[key])])),
    vehicles: all.filter(row => row.vehicleId.toLowerCase().includes(term) && (status === 'all' || row.status === status))
      .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))};
}

export function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(value));
  const part = key => parts.find(p => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function reportView(data, query = '', now = new Date()) {
  const today = shanghaiDate(now);
  // No published batch means no publishable data, even if a partial response has rows.
  const days = data.batch ? data.days || [] : [];
  const todayRows = days.filter(row => row.day === today);
  const selected = todayRows;
  const term = query.trim().toLowerCase();
  const vehicles = new Map();
  for (const row of todayRows) vehicles.set(row.vehicle_id, (vehicles.get(row.vehicle_id) || 0) + Number(row.sample_count || 0));
  return {
    hasToday: todayRows.length > 0,
    seen: vehicles.size,
    vehicles: [...vehicles].filter(([id]) => id.toLowerCase().includes(term)).sort(([a], [b]) => a.localeCompare(b)),
    days: selected.filter(row => row.vehicle_id.toLowerCase().includes(term)).sort((a, b) => b.day.localeCompare(a.day) || a.vehicle_id.localeCompare(b.vehicle_id)),
    samples: selected.reduce((sum, row) => sum + Number(row.sample_count || 0), 0),
    distance: selected.reduce((sum, row) => sum + Number(row.distance_km || 0), 0),
    temperature: selected.length ? Math.max(...selected.map(row => Number(row.max_temp_c))) : null,
    anomalies: selected.reduce((sum, row) => sum + Number(row.high_temp_samples || 0), 0),
    windows: data.batch ? (data.windows || []).filter(row => {
      const day = shanghaiDate(row.bucket_start); return day === today;
    }) : [],
  };
}
export function speedBuckets(windows) {
  const buckets = new Map();
  for (const row of windows) {
    const count = Number(row.sample_count), speed = Number(row.avg_speed_kph);
    if (!(count > 0) || !Number.isFinite(speed) || !Number.isFinite(Date.parse(row.bucket_start))) continue;
    const bucket = buckets.get(row.bucket_start) || {sum: 0, count: 0};
    bucket.sum += speed * count; bucket.count += count;
    buckets.set(row.bucket_start, bucket);
  }
  return [...buckets].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([at, bucket]) => ({at, speed: bucket.sum / bucket.count}));
}
