FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build typescript
RUN npx tsc

# Seed the database during build for the demo container
RUN npm run seed:demo

EXPOSE 3001
CMD ["node", "dist/index.js"]
