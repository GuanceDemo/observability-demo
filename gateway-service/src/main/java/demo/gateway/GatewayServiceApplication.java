package demo.gateway;

import java.time.Duration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestTemplate;

@SpringBootApplication
public class GatewayServiceApplication {
  public static void main(String[] args) {
    SpringApplication.run(GatewayServiceApplication.class, args);
  }

  @Bean
  RestTemplate vehicleRestTemplate(RestTemplateBuilder builder) {
    return builder
        .connectTimeout(Duration.ofSeconds(3))
        .readTimeout(Duration.ofSeconds(90))
        .errorHandler(new PassthroughResponseErrorHandler())
        .build();
  }

  @Bean
  RestTemplate gatewayRestTemplate(RestTemplateBuilder builder) {
    return builder
        .connectTimeout(Duration.ofSeconds(3))
        .readTimeout(Duration.ofSeconds(15))
        .errorHandler(new PassthroughResponseErrorHandler())
        .build();
  }
}
