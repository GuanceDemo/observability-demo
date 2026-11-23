# Apply to tracing source mysql. Match both the project and its known caller.
# Keep database semantics and trace identity unchanged.
if service == "mysql" {
  if project == "mall-demo" && base_service == "order-service" {
    set_tag(service, "mall-mysql")
    set_measurement("mall-mysql")
  }
  if project == "wordpress-cve-lab" && base_service == "wordpress-cve-demo" {
    set_tag(service, "wordpress-mysql")
    set_measurement("wordpress-mysql")
  }
}
