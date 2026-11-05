# ------------------------------------------------------------------------------------------

FROM node:24-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Copy dependency-related file
COPY package.json .
COPY pnpm-lock.yaml .
COPY pnpm-workspace.yaml .
COPY patches ./patches

RUN corepack enable
RUN corepack install --global pnpm@11.28.10

# ------------------------------------------------------------------------------------------

FROM base AS deps
# Install only prod deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# ------------------------------------------------------------------------------------------

FROM deps AS builder
COPY . .
# Install including dev deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Build-time flag, on by default. Vite bakes it into the frontend at `pnpm build`, so it can only be set
# here (`--build-arg`), not at container run time. The default lives here because .dockerignore keeps the
# repository's .env files out of the build context. `--build-arg VITE_RISU_LEGAL_CONFIGURED=` (empty) opts out
# and keeps the legal-documents notice.
# It exists only in this builder stage and is not carried into the runtime image.
ARG VITE_RISU_LEGAL_CONFIGURED=TRUE
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm build

# ------------------------------------------------------------------------------------------

FROM base AS runtime
WORKDIR /app

COPY package.json .
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 6001

CMD ["pnpm", "runserver"]

# ------------------------------------------------------------------------------------------
