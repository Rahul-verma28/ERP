# AHEAD ERP web app. Built from the repository root (docker-compose sets the context) because the
# shared rules in backend/src/contracts are imported by the app.
FROM node:22-alpine AS build
WORKDIR /repo

# The shared contracts need the backend's packages (zod) to resolve
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev --ignore-scripts
COPY backend/src/contracts backend/src/contracts

COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
# Where the API is, as the browser's /api/v1 requests are passed to it by the web server
ARG BACKEND_URL=http://backend:5000
ENV BACKEND_URL=$BACKEND_URL NEXT_TELEMETRY_DISABLED=1
RUN cd frontend && npm run build

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/frontend
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "start"]
