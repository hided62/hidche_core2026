# TypeScript Rewrite Plan

The rewrite targets a pnpm workspace-based monorepo with Node.js services and
Vue 3 frontends.

## Planned Layout

- `/packages/common`: shared utilities and type definitions
- `/packages/logic`: pure game logic with DI and interfaces
- `/app/gateway-frontend`: gateway UI
- `/app/gateway-api`: gateway service
- `/app/game-frontend`: game UI
- `/app/game-api`: game backend per server profile
- `/app/game-engine`: turn daemon per server profile
- `/tools/build-scripts`: build and deployment scripts

## Runtime Stack (Planned)

- Backend: Node.js + Fastify
- API: tRPC + zod
- ORM: Prisma
- Frontend: Vue 3, Pinia, Vue Router, TailwindCSS, Vite
- Data: PostgreSQL, Redis sessions
- Testing: Vitest

## Profiles (Planned)

- `che`, `kwe`, `pwe`, `twe`, `nya`, `pya`
