# ── Backend (NestJS) image ────────────────────────────────────────────────────
# Multi-stage build: the first stage compiles TypeScript with all dev deps, the
# second stage keeps ONLY the compiled output + production deps, so the final
# image is small and contains no build tooling.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package*.json ./
RUN npm ci
# Now the source, then compile (nest build -> dist/).
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Install ONLY production dependencies (no NestJS CLI, no test tooling).
COPY package*.json ./
RUN npm ci --omit=dev
# Bring over just the compiled app from the build stage.
COPY --from=build /app/dist ./dist
# The server listens on 3000 (see src/main.ts).
EXPOSE 3000
# NOTE: serviceAccountKey.json and .env are NOT copied in — they are provided at
# runtime by docker-compose (a mounted file + env_file) so secrets never live
# inside the image.
CMD ["node", "dist/main"]
