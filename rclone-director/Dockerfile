# Rclone Director - Production Dockerfile
# Supports Community and Commercial editions via EDITION build arg

# Build argument (set at build time)
ARG EDITION=commercial

FROM node:18-alpine

# Re-declare ARG after FROM to make it available
ARG EDITION
ENV EDITION=${EDITION}

# Set working directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY auth.js ./
COPY config ./config
COPY services ./services
COPY routes ./routes
COPY oauth ./oauth

# Copy and run edition preparation script
COPY scripts ./scripts
RUN node scripts/prepare-edition.js

# Create data directory
RUN mkdir -p /config

# Expose port
EXPOSE 5573

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5573/director/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Add edition info as labels
LABEL io.speedbits.rclone.edition="${EDITION}" \
      io.speedbits.rclone.version="1.0.0" \
      org.opencontainers.image.title="Rclone Director ${EDITION}" \
      org.opencontainers.image.description="Rclone Director API - ${EDITION} Edition" \
      org.opencontainers.image.vendor="SpeedBits / Smart In Venture"

# Run as non-root user
USER node

# Start server
CMD ["node", "server.js"]
