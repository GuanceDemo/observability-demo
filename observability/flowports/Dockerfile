FROM debian:bookworm-slim

ARG TARGETARCH

RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) sha256=fc1988add251a1e57dece2f255764d42364168f893cd08c9a8cc1c37efead0c2 ;; \
      arm64) sha256=2b4166f178e1ca635fdf3083c16b805b5a5c82ea29a727d92fdc4b5609cf5685 ;; \
      *) echo "Unsupported FlowPorts architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    rm -rf /var/lib/apt/lists/*; \
    workdir="$(mktemp -d)"; \
    archive="$workdir/flowport.tar.gz"; \
    curl -fsSL --retry 3 -o "$archive" \
      "https://flowport.pages.dev/releases/0.5.13/flowport_0.5.13_linux_${TARGETARCH}.tar.gz?build=ff8ab837d096c13f6185c7923dde1cf6b2ee0d4c"; \
    printf '%s  %s\n' "$sha256" "$archive" | sha256sum -c -; \
    tar -xzf "$archive" -C "$workdir"; \
    binary="$(find "$workdir" -type f -name collectway -print -quit)"; \
    test -n "$binary"; \
    install -m 0755 "$binary" /usr/local/bin/collectway; \
    mkdir -p /var/lib/flowport; \
    rm -rf "$workdir"

EXPOSE 8080 8081 1515/udp 1515/tcp
ENTRYPOINT ["/usr/local/bin/collectway"]
CMD ["-data-dir", "/var/lib/flowport", "-admin-listen", "0.0.0.0:8080", "-ingest-listen", "0.0.0.0:8081"]
