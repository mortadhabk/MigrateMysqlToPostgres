# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./

RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app .

# Create necessary directories
RUN mkdir -p uploads logs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "server.js"]
