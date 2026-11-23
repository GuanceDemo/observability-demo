# Only the three owned services use this local receiver script. Preserve trace,
# span, parent, native messaging fields and all business payloads unchanged.
if service == "vehicle-android-producer" || service == "emqx" || service == "vehicle-flink-consumer" {
    strfmt(context_url, "http://127.0.0.1:18092/context?service=%s&start=%v", service, start)
    response = http_request("GET", context_url)
    if response["status_code"] == 200 {
        context = load_json(response["body"])
        add_key(pipeline, context["pipeline"])
        add_key(cluster, context["cluster"])
        add_key(topic, context["topic"])
        add_key(consumer_group, context["consumer_group"])
        add_key(component, context["component"])
        set_tag(pipeline)
        set_tag(cluster)
        set_tag(topic)
        set_tag(consumer_group)
        set_tag(component)
        add_key(run_correlation, context["run_correlation"])
        if context["job_name"] != nil {
            add_key(job_namespace, context["job_namespace"])
            add_key(job_name, context["job_name"])
            set_tag(job_namespace)
            set_tag(job_name)
        }
        if context["run_id"] != nil {
            add_key(run_id, context["run_id"])
        }
    }
    drop_key(context_url)
}
