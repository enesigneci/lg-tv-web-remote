FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js lounge.js index.html ./
# TV eşleşme anahtarı eklentinin kalıcı /data klasöründe tutulur.
ENV KEY_FILE=/data/tv-key
CMD ["node", "server.js"]
