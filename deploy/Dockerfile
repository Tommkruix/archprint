FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG ARCHPRINT_VERSION=0.7.1
RUN npm install -g "archprint@${ARCHPRINT_VERSION}" && npm cache clean --force

USER node
ENV NODE_ENV=production

CMD ["archprint", "mcp", "--http"]
