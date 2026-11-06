CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id CHAR(36) PRIMARY KEY, job_name VARCHAR(96) NOT NULL, engine VARCHAR(24) NOT NULL,
  state VARCHAR(16) NOT NULL, started_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL, finished_at DATETIME(3) NULL,
  input_count BIGINT NULL, output_count BIGINT NULL, error_code VARCHAR(96) NULL,
  metadata JSON NULL, INDEX(job_name, started_at)
);
CREATE TABLE IF NOT EXISTS lineage_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, event_key VARCHAR(200) NOT NULL UNIQUE,
  run_id CHAR(36) NOT NULL, payload LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3) NULL, attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(64) NULL, INDEX(delivered_at, id)
);
CREATE TABLE IF NOT EXISTS component_state (
  component VARCHAR(24) PRIMARY KEY, instance_key VARCHAR(128) NOT NULL,
  run_id CHAR(36) NOT NULL, last_seen_at DATETIME(3) NOT NULL,
  last_emitted_at DATETIME(3) NOT NULL, payload JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS emqx_snapshot (
  id INT PRIMARY KEY, received_at DATETIME(3) NOT NULL, payload JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS report_batches (
  run_id CHAR(36) PRIMARY KEY, generated_at DATETIME(3) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL, object_count INT NOT NULL,
  input_rows BIGINT NOT NULL, unique_rows BIGINT NOT NULL,
  first_event_ms BIGINT NOT NULL, last_event_ms BIGINT NOT NULL,
  window_start_ms BIGINT NOT NULL, window_end_ms BIGINT NOT NULL,
  INDEX(generated_at)
);
CREATE TABLE IF NOT EXISTS vehicle_summary_5m (
  bucket_start DATETIME NOT NULL, vehicle_id VARCHAR(64) NOT NULL,
  sample_count BIGINT NOT NULL, avg_speed_kph DOUBLE NOT NULL, max_speed_kph DOUBLE NOT NULL,
  distance_km DOUBLE NOT NULL, min_soc_pct DOUBLE NOT NULL, max_temp_c DOUBLE NOT NULL,
  high_temp_samples BIGINT NOT NULL, low_soc_samples BIGINT NOT NULL, charge_samples BIGINT NOT NULL,
  first_sequence BIGINT NOT NULL, last_sequence BIGINT NOT NULL,
  run_id CHAR(36) NOT NULL, PRIMARY KEY(bucket_start, vehicle_id)
);
CREATE TABLE IF NOT EXISTS vehicle_daily_summary (
  day DATE NOT NULL, vehicle_id VARCHAR(64) NOT NULL,
  sample_count BIGINT NOT NULL, avg_speed_kph DOUBLE NOT NULL, max_speed_kph DOUBLE NOT NULL,
  distance_km DOUBLE NOT NULL, min_soc_pct DOUBLE NOT NULL, max_temp_c DOUBLE NOT NULL,
  high_temp_samples BIGINT NOT NULL, low_soc_samples BIGINT NOT NULL, charge_samples BIGINT NOT NULL,
  first_sequence BIGINT NOT NULL, last_sequence BIGINT NOT NULL,
  run_id CHAR(36) NOT NULL, PRIMARY KEY(day, vehicle_id)
);
