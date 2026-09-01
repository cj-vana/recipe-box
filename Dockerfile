FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_FILE=/app/data/recipes.json

COPY package.json server.js ./
COPY lib ./lib
COPY data/seed-recipes.json ./data/seed-recipes.json
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
