FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg curl

COPY server.mjs ./server.mjs

EXPOSE 3100

CMD ["node", "server.mjs"]
