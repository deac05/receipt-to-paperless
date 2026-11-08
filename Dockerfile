FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
ENV APP_DATA_DIR=/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
