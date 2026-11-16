FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
# players.json lives here; owned by node so a mounted volume is writable
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
