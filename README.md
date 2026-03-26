# SpecForge

SpecForge is an open source framework for spec-driven development with AI agents.

It helps software engineers turn ideas into executable specifications, plan implementation, ship code with AI agents, and keep documentation in sync as systems evolve.

## Vision

Build enterprise-grade software with a workflow where specifications are living artifacts, not stale documents.

## Target Users

Software engineers and engineering teams using AI agents to deliver production systems.

## MVP Agent Support

- OpenCode
- Codex
- Claude Code

## Core Philosophy

SpecForge treats software delivery as a structured lifecycle:

1. Capture ideas
2. Transform ideas into specs
3. Plan implementation
4. Implement with AI agents
5. Refine existing specs
6. Refactor existing features through specs
7. Preserve history of changes and technical decisions

This keeps specs in an always-actual state and makes evolution of the codebase traceable over time.

## Why SpecForge

- AI coding is fast, but intent and architecture can be lost.
- Specs often diverge from implementation.
- Technical decisions and rationale are rarely tracked consistently.

SpecForge closes this gap by making the spec workflow a first-class part of engineering execution.

## Project Goals

- Make spec-driven development practical with AI agents.
- Keep requirements, implementation plans, and code aligned.
- Enable safe iteration, refinement, and refactoring of existing systems.
- Maintain transparent decision logs and full change history.

## Current Status

SpecForge has implemented the MVP workflow and is in release-readiness validation.

Current focus:

- Final packaging and install smoke checks
- Final reviewer gate pass (architecture, requirements, security, tests, CLI, docs)
- Release notes and publish checklist completion

## Runtime Prerequisite (MVP)

- Runtime workflow commands require `.specforge/config.yaml`.
- The file currently stores JSON content at the `.yaml` path.
- `audit` config is required (`driver: memory` or `driver: postgres`).

Minimal local config example:

```json
{
  "audit": {
    "driver": "memory"
  },
  "docsStore": {
    "provider": "local-md",
    "rootDir": "."
  }
}
```

## Architecture and Planning Docs

- `ARCHITECTURE.md` - high-level system architecture
- `IMPLEMENTATION_ARCHITECTURE_SPEC.md` - package/component blueprint and API contracts
- `IMPLEMENTATION_PLAN.md` - granular parallel implementation plan with coding and review subagent statements
- `SPECFORGE_MVP_EVENT_STORMING.md` - event-storming decisions and workflow rules
- `specs/index.md` - ordered implementation specs

## Contributor Execution Notes

- Use `IMPLEMENTATION_PLAN.md` as the primary task backlog and milestone gate.
- Follow dependency direction from `IMPLEMENTATION_ARCHITECTURE_SPEC.md` (`cli -> application -> domain -> contracts`, adapters via ports).
- Implement in milestone order (`M0` to `M6`) and do not skip required reviewer gates.
- Run standard verification before sharing changes:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- For CLI scenario work, also run:
  - `pnpm --filter @specforge/cli test:e2e`

Local agent guidance:

- `AGENTS.md` is used as the local working guide for coding agents.

## Contributing

Contributions and feedback are welcome. If this vision resonates with you, open an issue or start a discussion.

## License

MIT
