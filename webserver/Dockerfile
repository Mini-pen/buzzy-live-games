# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app/webserver
COPY webserver/package.json ./
RUN npm install

FROM deps AS build
WORKDIR /app/webserver
COPY webserver/ ./
COPY games /app/games
ENV GAMES_DIR=/app/games
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/webserver
ENV NODE_ENV=production
ENV PORT=3000
ENV GAMES_DIR=/app/games
COPY webserver/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/webserver/dist ./dist
COPY --from=build /app/games /app/games
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node --input-type=module -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
