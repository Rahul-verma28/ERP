# AHEAD ERP API (with the in-process worker). On start it waits for PostgreSQL, creates the
# database if missing, applies migrations and syncs reference data, then serves on :5000.
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production PORT=5000 STORAGE_DIR=/data/storage
EXPOSE 5000
# Uploaded photos and documents live here (a volume in docker-compose)
VOLUME ["/data/storage"]
CMD ["sh", "-c", "npx tsx scripts/db-prepare.ts && node dist/server.js"]
