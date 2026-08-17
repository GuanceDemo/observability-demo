CREATE TABLE IF NOT EXISTS demo_orders (
    order_id VARCHAR(64) NOT NULL,
    sku VARCHAR(96) NOT NULL,
    quantity INT NOT NULL,
    amount_cent INT NOT NULL,
    status VARCHAR(32) NOT NULL,
    key_request VARCHAR(128) NULL,
    business_request_id VARCHAR(192) NULL,
    user_id VARCHAR(128) NULL,
    created_at TIMESTAMP(3) NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (order_id),
    INDEX idx_demo_orders_business_request (business_request_id),
    INDEX idx_demo_orders_user (user_id),
    INDEX idx_demo_orders_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
