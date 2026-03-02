# Multi-stage build for API service
FROM oven/bun:1.1.38-slim AS base

WORKDIR /app

# Install dependencies stage
FROM base AS deps

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Build stage
FROM base AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy all source code
COPY . .

# Build the API
RUN bun run build

# Production stage
FROM base AS runner

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Copy node_modules for runtime dependencies (includes drizzle-kit binary)
COPY --from=builder /app/node_modules ./node_modules

# Copy schema files and drizzle config for drizzle-kit push at startup
COPY --from=builder /app/lib/db/schema ./lib/db/schema
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Set environment to production
ENV NODE_ENV=production
# Do NOT set PORT here - Railway injects it at runtime

EXPOSE 3000

# Health check - use PORT from environment
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e 'fetch(`http://localhost:${process.env.PORT || 3000}/health`).then(r => r.ok ? process.exit(0) : process.exit(1))'

# Run drizzle-kit push in background (hangs after completion due to unclosed DB pool)
# & lets server start immediately without waiting for push to exit
CMD ["sh", "-c", "bunx drizzle-kit push & exec bun run start"]
