package demo.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class MobileBookContentControllerTest {
  @Test
  void contentUsesCanonicalBookAndLanguageWithRequestScopedDelay() throws Exception {
    List<Long> delays = new ArrayList<>();
    MockMvc mvc = MockMvcBuilders.standaloneSetup(
        new MobileBookContentController(new ObjectMapper(), delays::add)).build();
    mvc.perform(get("/api/demo/mobile/book-content").param("bookId", "observability-engineering")
        .param("mode", "slow"))
        .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.title").value("可观测性工程"))
        .andExpect(jsonPath("$.parts").isArray());
    mvc.perform(get("/api/demo/mobile/book-content").param("bookId", "observability-engineering")
        .param("mode", "timeout").param("lang", "en"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Observability Engineering"));
    mvc.perform(get("/api/demo/mobile/book-content").param("bookId", "observability-engineering"))
        .andExpect(status().isOk());
    assertThat(delays).containsExactly(3500L, 5000L);
  }

  @Test
  void invalidOrUnknownInputsCannotChooseTargetsOrArbitraryDelay() throws Exception {
    List<Long> delays = new ArrayList<>();
    MockMvc mvc = MockMvcBuilders.standaloneSetup(
        new MobileBookContentController(new ObjectMapper(), delays::add)).build();
    mvc.perform(get("/api/demo/mobile/book-content").param("bookId", "missing"))
        .andExpect(status().isNotFound());
    for (String[] parameter : List.of(new String[]{"mode", "../other"},
        new String[]{"lang", "ja"}, new String[]{"delayMs", "999999"},
        new String[]{"url", "https://example.invalid"})) {
      mvc.perform(get("/api/demo/mobile/book-content").param("bookId", "observability-engineering")
          .param(parameter[0], parameter[1])).andExpect(status().isBadRequest());
    }
    mvc.perform(post("/api/demo/mobile/book-content")).andExpect(status().isMethodNotAllowed());
    assertThat(delays).isEmpty();
  }
}
