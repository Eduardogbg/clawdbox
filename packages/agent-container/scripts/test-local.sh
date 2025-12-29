#!/bin/bash
# Test the agent container locally
# Requires: Docker, ANTHROPIC_API_KEY

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$CONTAINER_DIR")")"

echo "=== Agent Container Local Test ==="
echo "Container dir: $CONTAINER_DIR"
echo "Project root: $PROJECT_ROOT"

# Check requirements
if ! command -v docker &> /dev/null; then
    echo "Error: docker is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: ANTHROPIC_API_KEY is required"
    exit 1
fi

# Build TypeScript
echo "Building TypeScript..."
cd "$CONTAINER_DIR"
bun run build

# Build Docker image
echo "Building Docker image..."
docker build -t clawdbox-agent:test .

# Create test config
TEST_CONFIG=$(cat <<EOF
{
  "taskId": "test-$(date +%s)",
  "repoUrl": "https://github.com/octocat/Hello-World.git",
  "branch": "master",
  "prompt": "List the files in this repository and describe what you see.",
  "operatorUrl": "http://host.docker.internal:8787"
}
EOF
)

echo "Test config:"
echo "$TEST_CONFIG"

# Run container
echo "Running container..."
docker run --rm \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e AGENT_CONFIG="$TEST_CONFIG" \
  --add-host=host.docker.internal:host-gateway \
  clawdbox-agent:test

echo "=== Test complete ==="
