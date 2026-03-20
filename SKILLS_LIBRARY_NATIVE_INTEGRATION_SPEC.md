# Skills Library Native Integration Spec

## Goal

Make Drone Hub the source of truth for a shared skills library that is natively usable by all built-in agent CLIs:

- Codex
- Cursor Agent
- Claude Code
- OpenCode

The Hub should manage one canonical skill package format and project that package into each agent's native discovery locations without forcing authors to maintain four separate copies.

## Decision Summary

- Use the open Agent Skills package shape as the canonical on-disk format.
- Do not invent a Drone-specific `SKILL.md` superset as the primary format.
- Store agent-specific extensions as Hub-side overlay data and render them only into agent-native projections.
- Use `.agents/skills/` as the primary project-level projection because it is the strongest shared denominator across Codex, Cursor, and OpenCode.
- Mirror the same skill package into agent-native locations for best compatibility and UX:
  - `.claude/skills/`
  - `.cursor/skills/`
  - `.opencode/skills/`

## Why This Design

This design minimizes translation risk and preserves portability:

- Codex documents `.agents/skills` as its portable repo and user skill path and supports optional `agents/openai.yaml` metadata.
- Cursor natively supports `.agents/skills`, `.cursor/skills`, and `~/.cursor/skills`, and also reads Claude and Codex-compatible skill locations.
- Claude Code uses the same `SKILL.md` package model but adds richer frontmatter and plugin-managed distribution.
- OpenCode supports its own locations plus `.claude/skills` and `.agents/skills`.

The practical implication is that one portable package plus thin per-agent projections is the right architecture.

## Scope

### In

- Hub-managed shared skill library
- Native skill projection for Codex, Cursor Agent, Claude Code, and OpenCode
- Project-level and user-level sync for host and container drones
- Session staleness and restart guidance after library changes
- Migration from the current simple `content`-blob implementation

### Out

- Third-party agent CLIs beyond the four built-ins
- Remote public skill marketplace
- Cross-organization publishing workflows
- Binary asset editing in the browser as a first step

## Canonical Skill Package

Each skill in the Hub should map to a portable package:

```text
<skill-slug>/
  SKILL.md
  scripts/        # optional
  references/     # optional
  assets/         # optional
```

`SKILL.md` is the canonical skill entrypoint.

### Canonical Frontmatter

The portable core should support only fields that are common and low-risk across the ecosystem:

- `name`
- `description`
- `license` (optional)
- `compatibility` (optional)
- `metadata` (optional string map)

The Hub should require `name` and `description` even if some agents allow omission. This keeps the canonical package strict and portable.

### Agent-Specific Overlays

Agent-specific fields should not live in the canonical `SKILL.md` unless they are part of the portable core.

Store these separately in the Hub registry:

- `codex`
  - `openaiYaml`
- `claude`
  - `argumentHint`
  - `disableModelInvocation`
  - `userInvocable`
  - `allowedTools`
  - `model`
  - `context`
  - `agent`
  - `hooks`
- `cursor`
  - `disableModelInvocation`
- `opencode`
  - reserved for future agent-specific additions

## Hub Registry Model

Replace the current simple skill entry with a package-aware record:

```ts
type SkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  markdownBody: string;
  files: SkillFileEntry[];
  overlays?: SkillOverlaySet;
  createdAt: string;
  updatedAt: string;
};

type SkillFileEntry = {
  path: string; // relative to the skill root
  content: string;
  kind: "script" | "reference" | "asset" | "extra";
};
```

Notes:

- `SKILL.md` is rendered from the structured fields plus `markdownBody`.
- Supporting files are stored as explicit relative-path entries.
- We should preserve a stable `slug` because folder names matter to every agent.

## Projection Rules

The Hub should render the same canonical package into multiple agent-native locations.

### Project-Level Projections

- Canonical shared projection:
  - `.agents/skills/<slug>/...`
- Native mirrors:
  - `.claude/skills/<slug>/...`
  - `.cursor/skills/<slug>/...`
  - `.opencode/skills/<slug>/...`

### User-Level Projections

For non-repo sessions or shells that are not anchored to a repository:

- `~/.agents/skills/<slug>/...`
- `~/.claude/skills/<slug>/...`
- `~/.cursor/skills/<slug>/...`
- `~/.config/opencode/skills/<slug>/...`

### Codex-Specific Rendering

Codex's portable skill location is `.agents/skills`, but it also supports optional `agents/openai.yaml` inside each skill package.

If the Hub skill has a Codex overlay, render:

```text
<skill-root>/
  SKILL.md
  agents/
    openai.yaml
```

This keeps Codex-native app metadata and dependency declarations out of the canonical `SKILL.md`.

### Claude-Specific Rendering

When rendering to `.claude/skills`, merge Claude overlay fields into frontmatter for that projection only.

The underlying package content remains the same:

- same `SKILL.md` body
- same `scripts/`, `references/`, `assets/`
- Claude-only frontmatter added when present

### Cursor-Specific Rendering

Cursor now supports native `SKILL.md` skills, so the projection is mostly a path mirror.

If we need explicit-only invocation semantics in Cursor, render `disable-model-invocation` into the Cursor projection only.

Rules are not the primary transport for shared skills and should remain a separate feature for always-on instructions.

### OpenCode-Specific Rendering

OpenCode can read `.opencode/skills`, `.claude/skills`, and `.agents/skills`.

We should still render `.opencode/skills` explicitly so OpenCode has a first-class native location, while `.agents/skills` remains the shared portable projection.

## Sync Lifecycle

### Write Strategy

For each drone sync event:

1. Load the current Hub skill library.
2. Render canonical package output in memory.
3. Project the package into all relevant target directories.
4. Remove obsolete projected skill directories that no longer exist in the Hub library.
5. Write a library manifest with:
   - skill ids
   - slugs
   - updated timestamps
   - content hash

### Trigger Points

Sync should occur before:

- built-in prompt execution
- built-in agent chat turns
- terminal session open
- custom agent session open

### Target Selection

- If the drone session is repo-backed, prefer project-level projections.
- If the session is not repo-backed, also project into user-level locations.
- During migration, keep the current env-var bridge as a fallback, but native filesystem projections become primary.

## Session Reload Semantics

Skill changes should not recreate drones.

Instead:

- Mark all active sessions for that drone as `skills_stale`.
- Re-sync files on the next turn or session activation.
- Show restart guidance when the agent process may not pick up changes live.

Conservative policy:

- Built-in prompt turns: next turn gets the latest projections automatically.
- Long-lived custom sessions: restart recommended for guaranteed correctness.

UI affordance:

- `Restart sessions using updated skills`

## Migration From Current Implementation

The current implementation stores a simple skill record with a single `content` string.

Migration rules:

1. Convert each existing entry into a canonical package.
2. Generate `SKILL.md` from:
   - `name`
   - `description`
   - existing `content` as the markdown body
3. Initialize `files` to empty.
4. Initialize `overlays` to empty.
5. Preserve the existing id where possible.

Backward compatibility:

- Keep existing `/api/skills` CRUD shape working temporarily.
- Extend the API to support structured files and overlays.
- Continue writing the current shared env-var paths during the migration window so old session code does not break.

## Proposed API Evolution

### Read

- `GET /api/skills`
- `GET /api/skills/:id`

### Write

- `POST /api/skills`
- `PUT /api/skills/:id`
- `DELETE /api/skills/:id`

### New Package Endpoints

- `PUT /api/skills/:id/files`
- `DELETE /api/skills/:id/files/:path`
- `PUT /api/skills/:id/overlays/:agent`

## Testing Matrix

### Unit

- canonical `SKILL.md` rendering
- per-agent projection rendering
- manifest hashing
- migration from legacy skill entries

### Integration

- project-level sync writes all expected agent directories
- user-level sync writes all expected home directories
- obsolete skills are removed on sync
- overlay changes only affect the intended projections

### Behavioral

- built-in prompt turn sees newly added skill
- deleted skill disappears on next sync
- session staleness marker is set on library updates

## Implementation Phases

### Phase 1

- add canonical package schema to the registry
- add renderers for `SKILL.md` and supporting files
- add `.agents/skills` project and home projections

### Phase 2

- add native mirrors for Claude, Cursor, and OpenCode
- add Codex `agents/openai.yaml` projection
- add skill manifest hashing and stale-session tracking

### Phase 3

- update Hub UI to edit supporting files and overlays
- add restart-session UX after skill changes
- add migration command/path for legacy skill records

## Open Questions

- Whether we should support binary assets in the initial UI or keep the first version text-only.
- Whether user-level sync should always happen or only for sessions without a detected repo root.
- Whether Codex-specific `.codex` internal locations should remain a fallback bridge in runtime code even though `.agents/skills` is the documented portable path.

## Recommendation

Implement this spec with `.agents/skills` as the canonical projection and agent-native mirrors as compatibility and UX layers.

That gives us:

- one portable authoring format
- native integration for all four built-ins
- minimal translation logic
- a clear migration path from the current first-cut implementation
