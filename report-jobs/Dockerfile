FROM --platform=$BUILDPLATFORM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package -DskipTests

FROM eclipse-temurin:17-jre-jammy
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.version="0.1.0" org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
COPY --from=build /src/target/report-jobs-0.1.0.jar ./app.jar
COPY --from=build /src/target/lib ./lib
COPY entrypoint.sh ./entrypoint.sh
RUN groupadd --system app && useradd --system --gid app --uid 10001 app && chmod 0555 /app/entrypoint.sh
USER 10001:10001
ENV SPARK_LOCAL_IP=127.0.0.1
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["daily"]
