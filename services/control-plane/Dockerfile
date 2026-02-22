FROM node:20-slim

WORKDIR /app
COPY services/control-plane/package.json /app/package.json
COPY services/control-plane/server.mjs /app/server.mjs
COPY services/control-plane/persistence.mjs /app/persistence.mjs

RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client redis-tools && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
ENV CONTROL_PLANE_DATA_DIR=/var/lib/neurostore/control-plane
ENV STATE_BACKEND=file

RUN mkdir -p /var/lib/neurostore/control-plane

EXPOSE 8080
CMD ["node", "server.mjs"]
