FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG ARCHPRINT_VERSION=0.7.1
RUN npm install -g "archprint@${ARCHPRINT_VERSION}" && npm cache clean --force

USER node
ENV NODE_ENV=production

CMD ["archprint", "mcp", "--http"]
