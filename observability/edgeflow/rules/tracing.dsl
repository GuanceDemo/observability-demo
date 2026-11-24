version 1;

schema tracing {
  field.trace_id: string;
  field.resource: string;
  field.duration: number;
  tag.status: string;
  tag.route_class: string;
  tag.fault_id: string;
  tag.user_tier: string;
}

tail "mall_demo_tail_sampling" on tracing {
  group by field.trace_id;
  idle 5s max_wait 30s decision_ttl 2m;

  keep when any(tag.status == "error");
  keep when any(field.duration > 1000000);
  keep when any(tag.fault_id in ["order_slow", "redis_timeout", "payment_slow", "payment_error", "payment_cpu_burn"]);
  keep when any(tag.user_tier == "vip");

  drop when any(tag.route_class in ["unmatched", "static_asset"]);
  drop when any(field.resource in ["/health", "/healthz", "/ready", "/readyz", "/actuator/health"]);

  sample 0.1 otherwise seed "mall-demo-edgeflow-v1";
}
