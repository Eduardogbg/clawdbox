read CLAUDE.md. read `docs/tasks/001_alchemy_effect_cloudflare`.

inside `forks/alchemy-effect` we have a git submodule where an agent was responsible for adding cloudflare resources for the alchemy-effect. i think the code is not good. we should run more iterations to fix the code

afaik it only really added the secret store resource? it should rather be based on [this branch](https://github.com/alchemy-run/alchemy-effect/pull/26/files).

also on commit `eab9d2401e3954536f6f1796de9d90503b4ff51c` it did a very stupid thing:
- deleted `alchemy-effect/src/cloudflare/config.ts`
- added the following excerpt to `alchemy-effect/src/stage.ts`:
```
  /**
   * Cloudflare-specific configuration.
   */
  cloudflare?: {
    account?: string;
  };
```
- i'm not sure `alchemy-effect/src/env.ts` was correctly updated that seems weird
- i think the diff to `alchemy-effect/src/cloudflare/worker/worker.provider.ts` is weird too there's no reason to fix that type i think they wouldnt be pushing wrong typescript code to the repo

commit `553b9c616d5463bdb8d193394ff4fed6e864a15f` makes more sense

commit `898453ac11c89591109d5be6b4098d21d0f64825` looks innocuous

oh ok it is indeed based on that branch, it includes commit `13233970a6943f1c9b35f9a531d5a0727e5d11f5`

you NEED to control for the quality of the code, please analyze the code and guarantee it's good, use this first bad commit `eab9d2401e3954536f6f1796de9d90503b4ff51c` as example of what NOT to do, and commit `13233970a6943f1c9b35f9a531d5a0727e5d11f5` by the maintainers as the refenrece of what to do instead, so our secret store resource is not a reference but D1 and queue are. in fact I recommend branching off of commit `13233970a6943f1c9b35f9a531d5a0727e5d11f5` and starting the implementation from scratch
