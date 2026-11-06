package demo.vehicle.spark;

import java.util.Map;

record Settings(String mysqlHost, int mysqlPort, String mysqlUser, String mysqlPassword,
    String s3Endpoint, String s3AccessKey, String s3SecretKey, String lakeBucket,
    String jobNamespace, String mysqlNamespace, int maxObjects) {
  static Settings fromEnv() {
    Map<String, String> e = System.getenv();
    return new Settings(required(e, "MYSQL_HOST"), Integer.parseInt(e.getOrDefault("MYSQL_PORT", "3306")),
        required(e, "MYSQL_USER"), required(e, "MYSQL_PASSWORD"), required(e, "S3_ENDPOINT"),
        required(e, "S3_ACCESS_KEY"), required(e, "S3_SECRET_KEY"), e.getOrDefault("LAKE_BUCKET", "vehicle-lake"),
        e.getOrDefault("JOB_NAMESPACE", "vehicle-demo.telemetry"),
        e.getOrDefault("MYSQL_NAMESPACE", "mysql://demo-observability-demo-mysql:3306"),
        Integer.parseInt(e.getOrDefault("MAX_INPUT_OBJECTS", "12000")));
  }
  Settings {
    if (!mysqlHost.matches("[a-zA-Z0-9.-]+") || mysqlPort < 1 || mysqlPort > 65535 ||
        !lakeBucket.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]") || maxObjects < 1 || maxObjects > 20000)
      throw new IllegalArgumentException("invalid_settings");
    var endpoint = java.net.URI.create(s3Endpoint);
    if (!java.util.Set.of("http", "https").contains(endpoint.getScheme()) || endpoint.getHost() == null ||
        endpoint.getUserInfo() != null || endpoint.getQuery() != null || endpoint.getFragment() != null || !endpoint.getPath().isEmpty())
      throw new IllegalArgumentException("invalid_s3_endpoint");
  }
  String jdbcUrl() { return "jdbc:mysql://" + mysqlHost + ":" + mysqlPort + "/vehicle_analytics?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true&connectTimeout=10000&socketTimeout=120000&allowPublicKeyRetrieval=true"; }
  String lakeNamespace() { return "s3://" + lakeBucket; }
  private static String required(Map<String, String> e, String name) {
    String value = e.get(name);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("missing_" + name);
    return value;
  }
  @Override public String toString() { return "VehicleSettings[credentials omitted]"; }
}
