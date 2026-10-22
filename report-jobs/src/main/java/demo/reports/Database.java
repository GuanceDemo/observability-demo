package demo.reports;

import java.sql.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

final class Database implements AutoCloseable {
  final Connection connection;
  Database(Settings settings) throws SQLException {
    Properties properties = new Properties();
    properties.setProperty("user", settings.user());
    properties.setProperty("password", settings.password());
    properties.setProperty("connectionTimeZone", "UTC");
    properties.setProperty("forceConnectionTimeZoneToSession", "true");
    properties.setProperty("connectTimeout", "5000");
    properties.setProperty("socketTimeout", "120000");
    properties.setProperty("allowPublicKeyRetrieval", "true");
    properties.setProperty("rewriteBatchedStatements", "true");
    connection = DriverManager.getConnection(
        "jdbc:mysql://" + settings.host() + ":" + settings.port() + "/mall_reports", properties);
    connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
  }
  int execute(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = prepare(sql, args)) { return statement.executeUpdate(); }
  }
  List<Map<String, Object>> query(String sql, Object... args) throws SQLException {
    try (PreparedStatement statement = prepare(sql, args); ResultSet rs = statement.executeQuery()) {
      List<Map<String, Object>> rows = new ArrayList<>();
      while (rs.next()) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 1; i <= rs.getMetaData().getColumnCount(); i++) {
          String name = rs.getMetaData().getColumnLabel(i);
          int type = rs.getMetaData().getColumnType(i);
          Object value;
          if (type == Types.TIMESTAMP) {
            Timestamp timestamp = rs.getTimestamp(i, Calendar.getInstance(TimeZone.getTimeZone("UTC")));
            value = timestamp == null ? null : timestamp.toInstant();
          } else if (type == Types.DATE) value = rs.getObject(i, LocalDate.class);
          else value = rs.getObject(i);
          row.put(name, value);
        }
        rows.add(row);
      }
      return rows;
    }
  }
  PreparedStatement prepare(String sql, Object... args) throws SQLException {
    PreparedStatement statement = connection.prepareStatement(sql);
    statement.setQueryTimeout(90);
    for (int i = 0; i < args.length; i++) {
      if (args[i] instanceof Instant instant)
        statement.setTimestamp(i + 1, Timestamp.from(instant), Calendar.getInstance(TimeZone.getTimeZone("UTC")));
      else statement.setObject(i + 1, args[i]);
    }
    return statement;
  }
  void begin() throws SQLException { connection.setAutoCommit(false); }
  void commit() throws SQLException { connection.commit(); connection.setAutoCommit(true); }
  void rollback() throws SQLException {
    if (!connection.getAutoCommit()) connection.rollback();
    connection.setAutoCommit(true);
  }
  boolean lock() throws SQLException {
    return ((Number) query("SELECT GET_LOCK('mall-report-jobs',0) AS acquired").get(0).get("acquired")).intValue() == 1;
  }
  @Override public void close() throws SQLException { connection.close(); }
}
