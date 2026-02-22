FROM rust:1.85-bookworm AS builder
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN cargo build --release -p neuro-node -p neuro-uploader -p neuro-sentinel

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/neuro-node /usr/local/bin/neuro-node
COPY --from=builder /src/target/release/neuro-uploader /usr/local/bin/neuro-uploader
COPY --from=builder /src/target/release/neuro-sentinel /usr/local/bin/neuro-sentinel

RUN useradd -m -u 10001 neuro \
    && mkdir -p /var/lib/neuro-node \
    && chown -R neuro:neuro /var/lib/neuro-node /home/neuro
USER neuro
WORKDIR /home/neuro

EXPOSE 9000
ENTRYPOINT ["neuro-node"]
