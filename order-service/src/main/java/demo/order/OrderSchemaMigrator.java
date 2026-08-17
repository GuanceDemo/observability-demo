package demo.order;

import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class OrderSchemaMigrator implements ApplicationRunner {
  private static final Logger log = LoggerFactory.getLogger(OrderSchemaMigrator.class);
  private final JdbcTemplate jdbcTemplate;

  OrderSchemaMigrator(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public void run(ApplicationArguments arguments) throws SQLException {
    migrate();
  }

  void migrate() throws SQLException {
    DataSource dataSource = jdbcTemplate.getDataSource();
    if (dataSource == null) {
      throw new IllegalStateException("JdbcTemplate has no DataSource");
    }
    try (var connection = dataSource.getConnection()) {
      DatabaseMetaData metadata = connection.getMetaData();
      String catalog = connection.getCatalog();
      if (!hasColumn(metadata, catalog, "demo_orders", "user_id")) {
        jdbcTemplate.execute("ALTER TABLE demo_orders ADD COLUMN user_id VARCHAR(128) NULL");
        log.info("Database migration applied: demo_orders.user_id added");
      }
      if (!hasIndex(metadata, catalog, "demo_orders", "idx_demo_orders_user")) {
        jdbcTemplate.execute("CREATE INDEX idx_demo_orders_user ON demo_orders (user_id)");
        log.info("Database migration applied: idx_demo_orders_user added");
      }
    }
  }

  private boolean hasColumn(
      DatabaseMetaData metadata, String catalog, String table, String column) throws SQLException {
    try (ResultSet columns = metadata.getColumns(catalog, null, table, column)) {
      if (columns.next()) {
        return true;
      }
    }
    try (ResultSet columns =
        metadata.getColumns(catalog, null, table.toUpperCase(), column.toUpperCase())) {
      return columns.next();
    }
  }

  private boolean hasIndex(DatabaseMetaData metadata, String catalog, String table, String index)
      throws SQLException {
    if (hasIndex(metadata, catalog, table, index, false)) {
      return true;
    }
    return hasIndex(metadata, catalog, table.toUpperCase(), index, true);
  }

  private boolean hasIndex(
      DatabaseMetaData metadata,
      String catalog,
      String table,
      String index,
      boolean caseInsensitive)
      throws SQLException {
    try (ResultSet indexes = metadata.getIndexInfo(catalog, null, table, false, false)) {
      while (indexes.next()) {
        String found = indexes.getString("INDEX_NAME");
        if (found != null
            && (caseInsensitive ? found.equalsIgnoreCase(index) : found.equals(index))) {
          return true;
        }
      }
    }
    return false;
  }
}
