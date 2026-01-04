# Codex runner container for Cloudflare Containers

FROM oven/bun:latest

# System dependencies (git + node for codex CLI)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Codex CLI
RUN npm install -g @openai/codex

WORKDIR /agent

COPY package.json ./
RUN bun install --production

COPY src/ ./src/

# Default Codex settings
ENV CODEX_ARGS="--dangerously-bypass-approvals-and-sandbox -c notify=[] --skip-git-repo-check"
ENV CODEX_WORKDIR="/workspace/repo"

RUN mkdir -p /workspace/repo

EXPOSE 8080

ENTRYPOINT ["bun", "run", "/agent/src/index.ts"]
