FROM node:20-alpine

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies (will compile better-sqlite3)
RUN npm install --production

# Copy application code
COPY backend ./backend
COPY frontend ./frontend

# Create directory for persistent SQLite data
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "backend/src/index.js"]
