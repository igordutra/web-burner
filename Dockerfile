# Use official Node.js 24 Bookworm Slim image
FROM node:24-bookworm-slim

# Install system dependencies for audio encoding, CD burning, and ripping
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    cdrskin \
    xorriso \
    cdparanoia \
    eject \
    python3 \
    python3-pip \
    && pip3 install --no-cache-dir spotdl --break-system-packages \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency specifications and install production modules
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure storage directories exist
RUN mkdir -p uploads burn_temp rip_temp public

# Expose default application port
EXPOSE 3123

# Default environment configuration
ENV NODE_ENV=production
ENV PORT=3123

# Launch the server
CMD ["node", "server.js"]
