# Hitster — productie-image
FROM node:22-alpine

WORKDIR /app

# Eerst alleen de manifesten kopiëren zodat de npm-laag gecachet
# blijft zolang de dependencies niet wijzigen.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Daarna de applicatiecode.
COPY . .

ENV NODE_ENV=production
# PORT kan door de hostingomgeving worden overschreven; 3000 is de default.
EXPOSE 3000

# Draai als non-root gebruiker.
USER node

CMD ["node", "server.js"]
