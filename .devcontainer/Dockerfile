# The dev container (EMIT ADR-0007), as tutti's: Debian trixie, the same glibc as the service's distroless image
# (image/Dockerfile), so the binary that `make server` writes here runs there. Tools come from mise.toml, pinned
# exactly (EMIT ADR-0015); the copy in /opt/project is the global mise config, so they work outside the workspace.
FROM mcr.microsoft.com/devcontainers/rust:1-trixie@sha256:1648c1ac19ef6b55a001048d832956c109a5a9ad37fc6b3c82d37b6cd462bbf3

COPY --from=jdxcode/mise:2026.10.0-debian@sha256:8544c3c5648d98e93b22389ed8d208ec9470a2c92b027de85bb2dc4ed4545cb8 \
    /usr/local/bin/mise /usr/local/bin/mise
ENV MISE_DATA_DIR=/opt/mise \
    MISE_CONFIG_DIR=/opt/project \
    MISE_TRUSTED_CONFIG_PATHS=/ \
    PATH=/opt/mise/shims:$PATH
COPY mise.toml /opt/project/config.toml
COPY rust-toolchain.toml /opt/project/
RUN mise install && chmod -R a+rX /opt/mise \
    && cd /opt/project && rustup toolchain install \
    && chgrp -R rustlang "$RUSTUP_HOME" && chmod -R g+w "$RUSTUP_HOME"

# Chromium's system libraries for the Playwright version of client/pnpm-lock.yaml; `make setup` installs the
# browser itself as the container's user.
COPY client/package.json client/pnpm-lock.yaml /opt/project/client/
RUN cd /opt/project/client && pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm exec playwright install-deps chromium \
    && rm -rf node_modules /root/.local/share/pnpm /var/lib/apt/lists/*

# No general sudo (EMIT ADR-0007).
RUN rm -f /etc/sudoers.d/vscode

# The mount point of Claude's login volume; a new named volume takes over its owner.
RUN install -d -o vscode -g vscode /home/vscode/.claude
