FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
# Nicknames, looks and XP live in /data; mount a volume there so they survive redeploys.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
