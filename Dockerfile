FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lockb ./
# --ignore-scripts skips the husky "prepare" hook, which needs git
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY schema.sql tsconfig.json ./
COPY src ./src

USER bun
CMD ["bun", "run", "src/bot.ts"]
