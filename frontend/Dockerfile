# ── Pupu frontend (status page + admin dashboard, static build) ─────────────
# Deploy on Railway: service with Root Directory = frontend/
# Set REACT_APP_BACKEND_URL as a Railway variable BEFORE building — CRA bakes it in.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --non-interactive
COPY . .
RUN yarn build

FROM node:20-alpine
RUN npm install -g serve@14
WORKDIR /app
COPY --from=build /app/build ./build
CMD ["sh", "-c", "serve -s build -l ${PORT:-3000}"]
