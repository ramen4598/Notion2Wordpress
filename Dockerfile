# Multi-stage build for Notion2WordPress sync service
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy config (includes schema.sql) so it can be passed to final image
COPY config ./config

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune devDependencies for production image
RUN npm prune --omit=dev && npm cache clean --force

# Production stage
FROM node:20-alpine

# Install runtime dependencies for SQLite
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy production node_modules and package files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app
USER nodejs

# Expose health check port (optional)
EXPOSE 3000

# Start the sync service
CMD ["node", "dist/index.js"]
