FROM node:20-bookworm-slim

WORKDIR /app/server

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
