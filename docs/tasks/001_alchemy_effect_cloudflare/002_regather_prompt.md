read CLAUDE.md; read references/*; read 001_alchemy_effect_cloudflare/*; refer to 000_specs when need to decide the plan. your task is to understand the specs, what has been done, which state the codebase is in and what should be the next steps. don't mind the part about upstreaming cloudflare fix we are not doing that.

- check the local forks, guarantee they are in a branch that's only local to us and committed with no changes
- for the next steps we probably want to make sure we have good tests, since it's just iac it's probably better to do integration-tests, maybe assert a certain expected alchemy state or just test certain infra is there? whatever you deploy with tests make sure to teardown and name/tag appropriately
- we need to figure out if there are any other cloudflare resources we have to add and possibly patch the sdk/api schemas.
- start a TODO on root which we'll keep with a more stateful todo list (instead of something like here that i'm doing ad-hoc)
