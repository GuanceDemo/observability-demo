# syntax=docker/dockerfile:1
ARG MAVEN_BASE_IMAGE=docker.io/library/maven:3.9.9-eclipse-temurin-17
ARG JRE_BASE_IMAGE=docker.io/library/eclipse-temurin:17-jre-jammy

FROM --platform=$BUILDPLATFORM ${MAVEN_BASE_IMAGE} AS build
WORKDIR /workspace

COPY pom.xml ./
COPY gateway-service/pom.xml gateway-service/pom.xml
COPY order-service/pom.xml order-service/pom.xml
COPY game-service/pom.xml game-service/pom.xml
COPY inventory-service/pom.xml inventory-service/pom.xml
COPY payment-service/pom.xml payment-service/pom.xml

RUN --mount=type=cache,id=m2-repo,target=/root/.m2 \
    mvn -B -pl inventory-service -am dependency:go-offline

COPY inventory-service/src inventory-service/src
RUN --mount=type=cache,id=m2-repo,target=/root/.m2 \
    mvn -B -pl inventory-service -am package -DskipTests

FROM ${JRE_BASE_IMAGE}
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --uid 10001 app && \
    mkdir -p /var/log/observability-demo && chown -R app:app /app /var/log/observability-demo
COPY --from=build --chown=10001:10001 /workspace/inventory-service/target/inventory-service-1.0.0.jar /app/app.jar
USER app
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
