package demo.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Read-only book content; failure modes are scoped to this request, never global switches. */
@RestController
@RequestMapping("/api/demo/mobile/book-content")
class MobileBookContentController {
  private static final Set<String> PARAMETERS = Set.of("bookId", "lang", "mode");
  private final JsonNode catalog;
  private final Sleeper sleeper;

  @Autowired
  MobileBookContentController(ObjectMapper mapper) throws IOException {
    this(mapper, Thread::sleep);
  }

  MobileBookContentController(ObjectMapper mapper, Sleeper sleeper) throws IOException {
    try (var input = new ClassPathResource("mobile-book-content.json").getInputStream()) {
      catalog = mapper.readTree(input);
    }
    this.sleeper = sleeper;
  }

  @GetMapping
  ResponseEntity<JsonNode> get(@RequestParam Map<String, String> parameters)
      throws InterruptedException {
    if (!PARAMETERS.containsAll(parameters.keySet())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown book-content parameter");
    }
    String bookId = parameters.getOrDefault("bookId", "");
    String language = parameters.getOrDefault("lang", "zh");
    String mode = parameters.getOrDefault("mode", "normal");
    if (!Set.of("zh", "en").contains(language)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported language");
    }
    long delay = switch (mode) {
      case "normal" -> 0;
      case "slow" -> 3500;
      case "timeout" -> 5000;
      default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported content mode");
    };
    JsonNode book = catalog.get(bookId);
    if (book == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Book not found");
    }
    if (delay > 0) sleeper.sleep(delay);
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(book.get(language));
  }

  @FunctionalInterface
  interface Sleeper {
    void sleep(long millis) throws InterruptedException;
  }
}
