# Restaurant POS

Multi-tenant POS and back office for five Swedish restaurants, built to Skatteverket's cash-register rules. See [docs/proposal.md](docs/proposal.md) for the plan and [CLAUDE.md](CLAUDE.md) for the domain rules.

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev:api          # http://localhost:3000/health
pnpm dev:pos          # http://localhost:5173
pnpm dev:backoffice   # http://localhost:5174
```

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test
```
