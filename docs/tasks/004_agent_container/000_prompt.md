read AGENTS.md docs/ARCHITECTURE.md docs/tasks/003_post_ralph/009_cleanup_handoff.md and refer to `docs/tasks/000_specs`, `docs/references` and `docs/forks`. i let agents running loose on this codebase for too long, and i think we got some amount of progress but still missing a whole e2e flow of having an agent on a cloudflare container sending messages to tg. you will work on `004_agent_container`

- familiarize yourself with our iac package
- familiarize yourself with `https://github.com/banteg/takopi`. i've cloned it to `forks/takopi` but i need you to convert it to a git submodule
- basically we'll give up on doing the tg integration ourselves and just focus on deploying a takopi image to a cloudflare container which we provision with our iac stuff. leave telegram-webhook as it is for now

spec out this new design with takopi + cloudflare containers and do the chores i mentioned
