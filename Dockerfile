# use the official Bun image
FROM oven/bun:1.3 AS base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS release
COPY . .
COPY --from=install /temp/prod/node_modules node_modules

RUN chown -R bun:bun /usr/src/app
USER bun
EXPOSE 4040/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
