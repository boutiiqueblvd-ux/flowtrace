# FlowTrace

FlowTrace is a minimal workflow editor skeleton for a staff-engineer take-home assessment. It includes a small React/Vite frontend, a Fastify API, and basic validation and testing setup.

## Stack

- React + TypeScript + Vite
- React Flow + Zustand
- Fastify + TypeScript + Zod
- Vitest

## Prerequisites

- Node.js 20+
- npm 10+

## Install dependencies

```bash
npm install
```

## Run the app

Start the API:

```bash
npm run dev:api
```

Start the web app:

```bash
npm run dev:web
```

The API listens on `http://localhost:3001` and the web app on the Vite default port (usually `http://localhost:5173`).

## Useful scripts

```bash
npm run build
npm run typecheck
npm run test
```

## Notes

- This is intentionally a minimal skeleton for the assessment.
- Workflow execution and persistence are intentionally not implemented yet.
- The API includes a basic `/health` endpoint to confirm the service is running.
