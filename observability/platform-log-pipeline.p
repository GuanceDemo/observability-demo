add_pattern("POC_MLDATA", "[\\s\\S]*?")
add_pattern("POC_MLALL", "[\\s\\S]*")
add_pattern("POC_JAVA_EX_CLASS", "(?:[A-Za-z_$][\\w$]*\\.)*(?:[A-Za-z_$][\\w$]*(?:Exception|Error|Throwable)|Exception|Error|Throwable)")
add_pattern("POC_EX_THREAD", '(?:Exception in thread "[^"]*"\\s+)?')

grok(_, "%{TIMESTAMP_ISO8601:time}\\s+%{LOGLEVEL:status}\\s+\\[%{DATA:thread_name}\\]\\s+%{NOTSPACE:logger_name}\\s+-\\s+%{GREEDYDATA:log_message}\\s+\\|\\s+source=%{DATA:source}\\s+service=%{DATA:service}\\s+env=%{DATA:env}\\s+version=%{DATA:version}\\s+project=%{DATA:log_project}\\s+trace_id=%{DATA:trace_id}\\s+span_id=%{DATA:span_id}\\s+key_request=%{DATA:key_request}\\s+biz_request_id=%{DATA:biz_request_id}\\s+visitor_id=%{DATA:visitor_id}\\s+user_id=%{DATA:user_id}\\s+user_tier=%{DATA:user_tier}\\s+auth_state=%{DATA:auth_state}\\s+language=%{DATA:language}\\s+fault_id=%{DATA:fault_id}\\s+fault_layer=%{DATA:fault_layer}\\s+fault_kind=%{DATA:fault_kind}\\s+fault_target=%{DATA:fault_target}\\s+process_id=%{DATA:process_id}\\s+host_process_id=%{DATA:host_process_id}\\s+container_process_id=%{DATA:container_process_id}\\s+host=%{DATA:host}\\s+host_name=%{DATA:host_name}\\s+pod_name=%{DATA:pod_name}\\s+pod_namespace=%{DATA:pod_namespace}\\s+container_name=%{DATA:container_name}\\s+container_id=%{DATA:container_id}\\s+route_class=%{DATA:route_class}\\s+traffic_type=%{DATA:traffic_type}\\s+client_ip=%{DATA:client_ip}\\s+user_agent=%{DATA:user_agent}\\s+referer=%{GREEDYDATA:referer}")

if status == "ERROR" {
  grok(_, "%{GREEDYDATA}\\r?\\n%{GREEDYLINES:temp_error_stack}")

  if temp_error_stack {
    grok(temp_error_stack, '(?m)%{POC_MLDATA}^\\s*(?P<error_stack>%{POC_EX_THREAD}(?P<error_type>%{POC_JAVA_EX_CLASS}):\\s*(?P<error_message>%{POC_MLDATA})\\r?\\n\\s+at %{POC_MLALL})')

    if error_type == nil {
      grok(temp_error_stack, '(?m)%{POC_MLDATA}^\\s*(?P<error_stack>%{POC_EX_THREAD}(?P<error_type>%{POC_JAVA_EX_CLASS})\\r?\\n\\s+at %{POC_MLALL})')
    }
  }

  if error_type == nil {
    if logger_name {
      add_key(error_type, logger_name)
    } else {
      add_key(error_type, "JavaLogError")
    }
  }

  if error_message == nil {
    if log_message {
      add_key(error_message, log_message)
    }
  }
}

drop_key(temp_error_stack)
set_tag(project, log_project)
if route_class != "" && route_class != "-" {
  set_tag(route_class)
}
if traffic_type != "" && traffic_type != "-" {
  set_tag(traffic_type)
}
drop_key(log_project)
default_time(time, "Asia/Shanghai")
