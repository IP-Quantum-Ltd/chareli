# Use Node.js 22 as the base image (LTS version)
FROM node:24-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native builds if needed
RUN apk add --no-cache g++ make python3

# Copy package files
COPY package*.json ./
# Try to copy package-lock.json if it exists (won't fail if missing)
COPY package-lock.json* ./

# Install dependencies
# Use npm ci for reproducible builds
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Install only production dependencies in a clean node_modules
# This ensures all production deps including @sendgrid/mail are present
RUN npm ci --omit=dev

# Production stage
FROM node:24-alpine AS production

# Set working directory
WORKDIR /app

# Set node environment to production
ENV NODE_ENV=production

# Copy built application from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/ormconfig.json ./

# Copy healthcheck script
COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh && \
  addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app

USER appuser

# Create directories for logs and migrations with proper permissions
RUN mkdir -p logs /app/dist/migrations && chown -R appuser:appgroup logs /app/dist/migrations

# Expose the port the app runs on
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/healthcheck.sh"]

# Run migrations and start the app with PM2
CMD ["sh", "-c", "npm run typeorm migration:run -- -d dist/config/database.js && npx pm2-runtime start dist/index.js -i max"]
