FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY sites.example.json ./
COPY LICENSE README.md ./
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "src/server.mjs"]
