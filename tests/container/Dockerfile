# Real-CLI integration test image. Claude Code and Codex are pinned to the versions verified on 2026-10-12; Pi to
# 1.0.4 (the version in use on 2026-10-13, published as @earendil-works/pi-coding-agent) with the pi-custom-providers
# extension 0.4.3 installed. The extension is enabled per case: settings.json is removed so it starts disabled.
FROM node:22-bookworm
RUN npm install -g --silent \
    @anthropic-ai/claude-code@2.1.296 \
    @openai/codex@0.162.1 \
    @earendil-works/pi-coding-agent@1.0.4
RUN HOME=/root pi install npm:pi-custom-providers@0.4.3 && rm -f /root/.pi/agent/settings.json
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --silent
COPY src ./src
COPY tests/container ./tests/container
RUN mkdir -p /work
ENV HOME=/root
CMD ["npx", "tsx", "tests/container/run.ts"]
