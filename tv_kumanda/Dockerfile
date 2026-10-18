FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js lounge.js index.html ./
# The TV pairing key is kept in the add-on's persistent /data folder.
ENV KEY_FILE=/data/tv-key
# Port Home Assistant's ingress panel connects to (matches ingress_port in config.yaml).
ENV INGRESS_PORT=8099
CMD ["node", "server.js"]
