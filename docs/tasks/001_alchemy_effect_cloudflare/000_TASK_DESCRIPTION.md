# alchemy-effect cloudflare

## prerequisites
- `references/*`
- `tasks/000_specs/`
    - `000_GENESIS_PROMPT.md`
    - `001_ARCHITECTURE.md`
    - `002_CLOUDFLARE_SERVICES.md`
    - `003_ALCHEMY_EFFECT.md`
- https://github.com/alchemy-run/alchemy-effect/pull/26
    - use `gh` cli to inspect

## task

we need to support durable objects, hopefully secret store. please create a branch on top of the one of the PR and try to make the thing work. the way you are supposed to test this is by iterating on our repo (`clawdbox`) depending on the local version of `alchemy-effect` we will be working on, and trying to correctly deploy durable objects and whatever else we need using the iac approach.

### todo

- start the bun workspace
- create a package for iac
- go to `alchemy-effect`, create branch
- understand codebase, how to test and develop locally
- iterate until it works, or else yield back asking for clarifications, but try your best

## cloudflare token

you can use the following token to create other tokens with the permissions you need. eventually once we get to the secret spec task we will rotate all of these out and manage them securely so don't worry about exfiltration

- token: `Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT`
- curl example:
```
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
-H "Authorization: Bearer Kxr8D6C7WJ9eDX0H5pGPHClpA9TqUAMuwOjwb6IT"
```
