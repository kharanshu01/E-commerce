FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app/backend

# Install only production dependencies. The in-memory MongoDB package is a
# runtime dependency because the server can fall back to it when MongoDB is unavailable.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . ./

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]