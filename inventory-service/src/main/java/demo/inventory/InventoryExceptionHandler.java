package demo.inventory;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
class InventoryExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(InventoryExceptionHandler.class);

  @ExceptionHandler(QueryTimeoutException.class)
  ResponseEntity<Map<String, Object>> handleRedisTimeout(
      QueryTimeoutException exception, HttpServletRequest request) {
    DemoLanguage language = DemoLanguage.from(request.getHeader("X-Demo-Language"));
    log.error(
        language.text(
            "库存服务请求失败：Redis 命令超时 方法={} 路径={} 状态=503 异常={}",
            "Inventory request failed: Redis command timed out method={} path={} status=503 exception={}"),
        request.getMethod(),
        request.getRequestURI(),
        exception.getClass().getSimpleName(),
        exception);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("timestamp", Instant.now().toString());
    body.put("status", HttpStatus.SERVICE_UNAVAILABLE.value());
    body.put("error", HttpStatus.SERVICE_UNAVAILABLE.getReasonPhrase());
    body.put("message", "Redis command timed out");
    body.put("path", request.getRequestURI());
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
  }
}
