this repository is `clawdbox`, where i want to create a system where i can control my opinionated agents via telegram, inspired by `./claude-army`. but i much prefer typescript bun and effect. also i want to deploy on sandboxes on cloudflare (probably durable objects or something like that). for that i want to have a completely iac codebase with alchemy, a better terraform for typescript using effect. also we want to use the claude agents sdk in typescript so we can spawn custom agents. start working on the specs docs

- figure out which cloudflare services would be best to support our sandboxing (durable objects, workers etc). i don't necessarily think cloudflare ai is a good idea cuz i to use my claude subscription
- figure out how alchemy-effect works and how could we orchestrate that
- figure out how to deploy our long-running claude agent sdk to cloudflare in a way we can resume and stuff
- draft the telegram integration
- take inspiration from the features and design of our predecessor at `./claude-army` and `./docs/references/CLAUDE_ARMY_ARCH.md`
- one of my requirements is good secret management. i want to provision secret with alchemy-effect secrets api, and that includes like telegram api keys and whatnot. maybe need some secrets on github actions too. but also "customer" secrets like my claude api key. i think secretspec.toml is good for most of these.
- another important stateful thing to notice is the git repo itself. the agents will probably have to work on a repo that's a durable object, and if there are multiple agents it will all be different clones (or work-trees). i guess we can centralize on github for merging and stuff.
