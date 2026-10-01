FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG ARCHPRINT_VERSION=0.7.0
RUN npm install -g "archprint@${ARCHPRINT_VERSION}" && npm cache clean --force

USER node
ENV NODE_ENV=production

CMD ["archprint", "mcp", "--http"]
