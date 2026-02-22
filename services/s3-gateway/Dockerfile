FROM node:20-slim

WORKDIR /app
COPY services/s3-gateway/package.json /app/package.json
COPY services/s3-gateway/server.mjs /app/server.mjs

ENV NODE_ENV=production
ENV PORT=9009
ENV REQUIRE_AUTH=true
ENV CONTROL_PLANE_URL=http://control-plane:8080
ENV S3_DATA_DIR=/var/lib/neurostore/s3-gateway/data
ENV S3_META_FILE=/var/lib/neurostore/s3-gateway/metadata.json
ENV S3_MULTIPART_DIR=/var/lib/neurostore/s3-gateway/multipart

RUN mkdir -p /var/lib/neurostore/s3-gateway/data /var/lib/neurostore/s3-gateway/multipart

EXPOSE 9009
CMD ["node", "server.mjs"]
