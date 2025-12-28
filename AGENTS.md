# AGENTS.md

## general instructions
- use and maintain the TODO.md for long and short term plans
- when wrapping up your work write a handoff prompt on an appropriately prefixed document on the corresponding `docs/tasks` subfolder
- use `say` command when you want to yield back for any reason, be it cuz you are finished or cuz you need some clarifications or are stuck. be brief in your voice message, i'll be able to read your messages too
- never yield back before running typescript type-checks, just use tsc with noemit and be sure tsconfig makes sense
- use effect and focus on dependency-injection and testable code. make dependencies layers when possible, when acquiring resources that could leak be sure to use resource-aware patterns such as (but not limited to) `acquireUseRelease`. prefer more functional code to loops, prefer formatting pipes as `pipe(...)` rather than `whatever.pipe(...)`
- don't use any, you never need it. everything that's an external input can be validated by schemas, and everything else you should be able to infer a type

## references
- read `./docs/references/{ALCHEMY, EFFECT, CLAUDE_ARMY_ARCH, CLOUDFLARE}.md` when working with the respective techs
