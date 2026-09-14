# Multi-stage build for API service
FROM oven/bun:1.1.38-slim AS base

WORKDIR /app

# Install dependencies stage
FROM base AS deps

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies. NO `|| bun install` fallback: a lockfile mismatch must
# FAIL the build, not silently re-resolve floating ranges to newer versions
# (that once floated better-auth past its pin and broke OAuth via a schema drift).
RUN bun install --frozen-lockfile

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
COPY --from=builder /app/scripts/ensure-daily-reading-uniqueness.ts ./scripts/ensure-daily-reading-uniqueness.ts

# Campaign markdown, read from disk at runtime (src/lib/campaigns.ts) rather
# than bundled, so a new campaign is a file drop instead of a rebuild. Without
# this the image has no campaigns at all and /internal/campaigns returns [].
COPY --from=builder /app/content ./content

# Set environment to production
ENV NODE_ENV=production
# Do NOT set PORT here - Railway injects it at runtime

EXPOSE 3000

# Health check - use PORT from environment
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun run -e 'fetch(`http://localhost:${process.env.PORT || 3000}/health`).then(r => r.ok ? process.exit(0) : process.exit(1))'

# Enforce the daily-reading invariant before accepting traffic. Drizzle push
# remains in the background because its CLI keeps a DB pool open after applying.
CMD ["sh", "-c", "bun run scripts/ensure-daily-reading-uniqueness.ts && (bunx drizzle-kit push &) && exec bun run start"]
