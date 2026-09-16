package demo.game;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"rum.enabled=true", "rum.game-application-id=game-test",
    "rum.game-service=game-web", "demo.version=2.4.0", "demo.environment=test"})
@AutoConfigureMockMvc
class GameControllerTest {
  @Autowired MockMvc mvc;

  @Test void servesGamesWithoutDatabaseOrStorefront() throws Exception {
    for (String path : java.util.List.of("/game-hub.html", "/plants-game.html", "/webgl-replay-game.html",
        "/assets/game-runtime.js", "/assets/pvz/images/background1.jpg")) {
      mvc.perform(get(path)).andExpect(status().isOk());
    }
    mvc.perform(get("/shop.html")).andExpect(status().isNotFound());
    mvc.perform(get("/api/demo/auth/session")).andExpect(status().isNotFound());
    assertThat(getClass().getResource("/static/business.html")).isNull();
  }

  @Test void exposesIndependentConfigurationAndGameOnlyCatalog() throws Exception {
    mvc.perform(get("/api/games/rum-config"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.gameApplicationId").value("game-test"))
        .andExpect(jsonPath("$.version").value("2.4.0"))
        .andExpect(jsonPath("$.gameService").value("game-web"))
        .andExpect(jsonPath("$.env").value("test"));
    mvc.perform(get("/api/games/faults"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
        .andExpect(jsonPath("$.items[0].id").value("game_render_overload"))
        .andExpect(jsonPath("$.items[1].id").value("game_asset_load_failure"))
        .andExpect(jsonPath("$.items[0].clientSide").value(true))
        .andExpect(jsonPath("$.items[1].scenes[0]").value("webgl-game"));
  }

  @Test void preservesOriginalGameFaultMetadata() throws Exception {
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
    try (var expected = getClass().getResourceAsStream("/game-fault-catalog.json")) {
      var response = mvc.perform(get("/api/games/faults")).andReturn().getResponse();
      assertThat(mapper.readTree(response.getContentAsString()).get("items"))
          .isEqualTo(mapper.readTree(expected));
    }
  }

  @Test void preservesRealMissingResourceFaultAtBothUrls() throws Exception {
    for (String path : java.util.List.of("/api/demo/game-assets/orbital-shield-texture.webp",
        "/api/games/assets/orbital-shield-texture.webp")) {
      mvc.perform(get(path)).andExpect(status().isNotFound())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(header().string("X-Demo-Fault", "game_asset_load_failure"));
    }
  }
}
