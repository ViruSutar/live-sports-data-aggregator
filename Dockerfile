FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 is a native addon. These tools allow npm to build it if
# a prebuilt binary is not available for the container's Node.js version.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/matches.sqlite

RUN mkdir -p /app/data

EXPOSE 3000 4001

CMD ["npm", "start"]
