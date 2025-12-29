# Claude Agent SDK Container for Cloudflare Containers
# This image runs the Claude Agent SDK with full filesystem access for code editing tasks

FROM oven/bun:latest

# System dependencies for git operations and development tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (required for claude-code CLI and MCP servers)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install claude-code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create workspace directories
RUN mkdir -p /workspace /agent

# Set up agent runtime
WORKDIR /agent
COPY package.json ./
RUN bun install

# Copy agent source
COPY src/ ./src/
COPY dist/ ./dist/

# Configure git for operations
RUN git config --global user.email "agent@clawdbox.ai" && \
    git config --global user.name "Clawdbox Agent"

# Set working directory to workspace for agent operations
WORKDIR /workspace

# Expose port for health checks and callbacks
EXPOSE 8080

# Entrypoint runs the agent
ENTRYPOINT ["bun", "run", "/agent/dist/entrypoint.js"]
