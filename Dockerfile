# Stage 1: Build frontend and backend
FROM node:22-slim AS build

WORKDIR /app

# Copy workspace package files for dependency caching
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/

RUN npm ci

# Copy source and build both workspaces
COPY frontend/ frontend/
COPY backend/ backend/

RUN npm run build


# Stage 2: Production image with system Chromium
FROM node:22-slim

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libdrm2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
COPY backend/package.json backend/

RUN npm ci --omit=dev --workspace=backend

# Copy built artifacts
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/backend/dist backend/dist

# Data directory for SQLite + evidence screenshots
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "backend/dist/index.js"]
