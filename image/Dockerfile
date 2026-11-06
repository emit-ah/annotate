# The annotation service's image (ADR-0001): its binary, which `make build` wrote to build/target/release in the dev
# container's toolchain, on distroless with glibc, as tutti's image/annotations.Dockerfile. Its database lies in the
# user's home, where the stack mounts a volume. Build from the repo root: docker build -f image/Dockerfile .
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2

ARG VERSION=0.0.0
ARG REVISION=unknown
ARG SOURCE=https://github.com/emit-ah/annotate
LABEL org.opencontainers.image.title=annotate \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.source=$SOURCE

COPY build/target/release/annotations-server /usr/local/bin/annotations-server

USER 65532:65532
WORKDIR /home/nonroot
ENV ANNOTATIONS_DATABASE=/home/nonroot/annotations.db
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["/usr/local/bin/annotations-server", "health"]
ENTRYPOINT ["/usr/local/bin/annotations-server"]
CMD ["serve"]
