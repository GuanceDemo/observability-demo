ARG MAVEN_BASE_IMAGE=docker.io/library/maven:3.9.9-eclipse-temurin-17
ARG JRE_BASE_IMAGE=docker.io/library/eclipse-temurin:17-jre-jammy


FROM ${MAVEN_BASE_IMAGE} AS build
WORKDIR /workspace

COPY pom.xml ./
COPY gateway-service/pom.xml gateway-service/pom.xml
COPY order-service/pom.xml order-service/pom.xml
COPY game-service/pom.xml game-service/pom.xml
COPY inventory-service/pom.xml inventory-service/pom.xml
COPY payment-service/pom.xml payment-service/pom.xml

COPY . .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -pl order-service -am package -DskipTests

FROM ${JRE_BASE_IMAGE}
WORKDIR /app
COPY --from=build /workspace/order-service/target/order-service-1.0.0.jar /app/app.jar
RUN groupadd --system app && useradd --system --gid app --uid 10001 app && \
    mkdir -p /var/log/observability-demo && chown -R app:app /app /var/log/observability-demo
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
