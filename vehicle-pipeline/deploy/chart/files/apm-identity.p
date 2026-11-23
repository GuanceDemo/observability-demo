# Remove receiver defaults before resolving the actual component resource.
if service == "vehicle-android-producer" || service == "emqx" || service == "vehicle-flink-consumer" || service == "vehicle-spark-summary" {
    drop_key(host)
    drop_key(host_name)
    drop_key(pod_name)
    drop_key(pod_namespace)
    drop_key(pod_uid)
    drop_key(pod_ip)
    drop_key(k8s_node_name)
    drop_key(k8s_pod_name)
    drop_key(k8s_pod_uid)
    drop_key(k8s_namespace_name)
    add_key(resource_identity, "unknown")
    if service == "vehicle-android-producer" {
        add_key(resource_identity, "not_applicable")
    } else {
        instance = get_key("service_instance_id")
        if instance == nil { instance = "" }
        source_ip = get_key("collector_source_ip")
        strfmt(identity_url, "http://127.0.0.1:18093/identity?service=%s&instance=%v&ip=%v&start=%v", service, instance, source_ip, start)
        identity_response = http_request("GET", identity_url)
        if identity_response != nil {
          if identity_response["status_code"] == 200 {
            identity = load_json(identity_response["body"])
            add_key(resource_identity, identity["resource_identity"])
            if identity["host"] != nil {
                add_key(host, identity["host"])
                add_key(pod_name, identity["pod_name"])
                add_key(pod_namespace, identity["pod_namespace"])
                add_key(pod_uid, identity["pod_uid"])
                add_key(pod_ip, identity["pod_ip"])
                add_key(k8s_node_name, identity["host"])
                add_key(k8s_pod_name, identity["pod_name"])
                add_key(k8s_pod_uid, identity["pod_uid"])
                add_key(k8s_namespace_name, identity["pod_namespace"])
                set_tag(host)
                set_tag(pod_name)
                set_tag(pod_namespace)
                set_tag(pod_uid)
                set_tag(pod_ip)
                set_tag(k8s_node_name)
                set_tag(k8s_pod_name)
                set_tag(k8s_pod_uid)
                set_tag(k8s_namespace_name)
            }
          }
        }
        drop_key(identity_url)
    }
}
