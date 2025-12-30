FROM node:22-alpine

WORKDIR /app

COPY public ./public
COPY server.mjs ./server.mjs

EXPOSE 3000
CMD ["node", "server.mjs"]
