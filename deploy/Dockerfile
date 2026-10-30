FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG ARCHPRINT_VERSION=0.7.1
RUN npm install -g "archprint@${ARCHPRINT_VERSION}" && npm cache clean --force

USER node
ENV NODE_ENV=production

CMD ["archprint", "mcp", "--http"]
