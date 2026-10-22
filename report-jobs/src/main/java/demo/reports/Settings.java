package demo.reports;

import java.net.URI;
import java.util.Map;

record Settings(String host, int port, String user, String password, URI lineageUrl,
                String token, String jobNamespace, String datasetNamespace) {
  static Settings fromEnv(Map<String, String> env) {
    String host = env.getOrDefault("MYSQL_HOST", "demo-observability-demo-mysql");
    if (!host.matches("[A-Za-z0-9.-]+")) throw new IllegalArgumentException("MYSQL_HOST");
    int port = Integer.parseInt(env.getOrDefault("MYSQL_PORT", "3306"));
    if (port < 1 || port > 65535) throw new IllegalArgumentException("MYSQL_PORT");
    URI base = URI.create(env.getOrDefault("OPENLINEAGE_URL", "https://openway.guance.com"));
    if (!"https".equals(base.getScheme()) || base.getHost() == null || base.getUserInfo() != null
        || base.getQuery() != null || base.getFragment() != null
        || !(base.getPath().isEmpty() || base.getPath().equals("/"))) {
      throw new IllegalArgumentException("OPENLINEAGE_URL must be an HTTPS origin");
    }
    return new Settings(host, port, env.getOrDefault("MYSQL_USER", "mall_reports_writer"),
        required(env, "MYSQL_PASSWORD"), base.resolve("/v1/write/openlineage"),
        required(env, "OPENLINEAGE_TOKEN"),
        env.getOrDefault("OPENLINEAGE_JOB_NAMESPACE", "mall-demo.data-pipeline"),
        env.getOrDefault("OPENLINEAGE_DATASET_NAMESPACE", "mysql://demo-observability-demo-mysql:3306"));
  }

  private static String required(Map<String, String> env, String name) {
    String value = env.get(name);
    if (value == null || value.isBlank() || value.contains("\n") || value.contains("\r"))
      throw new IllegalArgumentException("Missing or invalid " + name);
    return value;
  }

  // Avoid the record's generated toString leaking credentials into diagnostics.
  @Override public String toString() { return "ReportSettings[redacted]"; }
}
