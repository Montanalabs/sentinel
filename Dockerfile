# Sentinel sidecar — official self-host image.
# Build:  docker build -t sentinel .
# Run:    docker run -p 4000:4000 --env-file .env sentinel
#   (mount a sentinel.config.mjs to wire your own connectors/packs — see docs/self-hosting.md)

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The sidecar defaults to loopback (the /v1/* API is unauthenticated); in a container it must bind all
# interfaces to be reachable via -p. Keep the published port behind a trusted network / gateway.
ENV SENTINEL_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Drop privileges: the node:*-alpine images ship an unprivileged `node` user. Run as it so a
# sidecar compromise isn't root in the container.
RUN chown -R node:node /app
USER node
EXPOSE 4000
# `sentinel start` boots the sidecar from the environment (and an optional sentinel.config.mjs).
ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["start"]
