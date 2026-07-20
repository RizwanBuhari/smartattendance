# ── Dashboard (React + Vite) image ────────────────────────────────────────────
# Stage 1 builds the static site; stage 2 serves it with nginx.
#
# IMPORTANT: Vite bakes VITE_* variables into the JS at BUILD time. This build
# reads them from dashboard/.env (present in the build context). Those values
# (the Firebase WEB config + API URL) are NOT secret — they already ship in the
# browser bundle — so it is fine for them to be baked in here.

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM nginx:alpine
# SPA routing config (so React Router deep links don't 404).
COPY nginx.conf /etc/nginx/conf.d/default.conf
# The built static files.
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
