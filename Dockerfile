# Multi-stage build for Rclone Web UI
# Stage 1: Build the React application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY .npmrc ./

# Install dependencies
# Using npm install instead of npm ci for better compatibility with legacy peer deps
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Setup rclone and nginx
FROM alpine:latest

# Install rclone, nginx, and required tools
RUN apk add --no-cache \
    rclone \
    nginx \
    curl \
    bash \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create necessary directories
RUN mkdir -p /run/nginx \
    /config/rclone \
    /data \
    /var/www/html

# Copy built React app from builder
COPY --from=builder /app/build /var/www/html

# Copy nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/default.conf /etc/nginx/http.d/default.conf

# Copy startup script
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

# Environment variables with defaults
ENV RCLONE_USER=admin
ENV RCLONE_PASS=admin
ENV RCLONE_PORT=5572
ENV FRONTEND_PORT=3000

# Expose ports
EXPOSE 3000 5572

# Volume for rclone config and data
VOLUME ["/config/rclone", "/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start services
CMD ["/start.sh"]
