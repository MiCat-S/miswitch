# Real-CLI integration test image. Versions are pinned to the ones verified on 2026-10-12.
FROM node:22-bookworm
RUN npm install -g --silent \
    @anthropic-ai/claude-code@2.1.296 \
    @openai/codex@0.162.1 \
    @mariozechner/pi-coding-agent@0.73.1
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --silent
COPY src ./src
COPY tests/container ./tests/container
RUN mkdir -p /work
ENV HOME=/root
CMD ["npx", "tsx", "tests/container/run.ts"]
