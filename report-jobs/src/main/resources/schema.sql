CREATE TABLE IF NOT EXISTS demo_business_daily (
  order_date DATE PRIMARY KEY,
  order_count BIGINT NOT NULL,
  units BIGINT NOT NULL,
  revenue_cent BIGINT NOT NULL,
  avg_order_cent DECIMAL(20,2) NOT NULL,
  revenue_share_pct DECIMAL(9,4) NOT NULL,
  is_partial BOOLEAN NOT NULL,
  source_run_id CHAR(36) NOT NULL,
  source_updated_at DATETIME(3) NOT NULL,
  run_id CHAR(36) NOT NULL,
  processed_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS demo_sales_trend (
  order_date DATE PRIMARY KEY,
  order_count BIGINT NOT NULL,
  units BIGINT NOT NULL,
  revenue_cent BIGINT NOT NULL,
  avg_order_cent DECIMAL(20,2) NOT NULL,
  revenue_share_pct DECIMAL(9,4) NOT NULL,
  is_partial BOOLEAN NOT NULL,
  previous_revenue_cent BIGINT NULL,
  revenue_change_pct DECIMAL(20,4) NULL,
  moving_avg_3d_cent DECIMAL(20,2) NOT NULL,
  cumulative_revenue_cent BIGINT NOT NULL,
  upstream_run_id CHAR(36) NOT NULL,
  source_run_id CHAR(36) NOT NULL,
  source_updated_at DATETIME(3) NOT NULL,
  run_id CHAR(36) NOT NULL,
  processed_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS report_runs (
  run_id CHAR(36) PRIMARY KEY,
  job VARCHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL,
  upstream_run_id CHAR(36) NULL,
  source_updated_at DATETIME(3) NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  row_count BIGINT NULL,
  error_code VARCHAR(64) NULL,
  INDEX(job, started_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS report_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3) NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(64) NULL,
  INDEX(delivered_at, id)
) ENGINE=InnoDB;
