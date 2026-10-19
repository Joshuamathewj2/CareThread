FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA plus a same-origin proxy to the MCP server. Buffering is off so Streamable HTTP's SSE responses stream.
RUN echo 'server { \
  listen 80; \
  location / { \
    root /usr/share/nginx/html; \
    try_files $uri $uri/ /index.html; \
  } \
  location /mcp { \
    proxy_pass http://server:3001; \
    proxy_http_version 1.1; \
    proxy_set_header Connection ""; \
    proxy_set_header Host $host; \
    proxy_buffering off; \
    proxy_cache off; \
    proxy_read_timeout 1h; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
