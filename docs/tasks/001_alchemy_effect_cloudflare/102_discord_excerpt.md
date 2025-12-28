alchemy discord conversation about cloudflare sdk. i'm "h.." (discord is bugged lol)

## transcript
h… — 19:10
hey guys is it common for Cloudflare SDK API Schemas to be wrong? I think it's wrong for the secrets store: https://gist.github.com/Eduardogbg/ff3753d1da0ad18c154cf5f17762f240
Gist
cloudflare secret store api schema bug
cloudflare secret store api schema bug. GitHub Gist: instantly share code, notes, and snippets.
cloudflare secret store api schema bug
was trying to implement my own resources
John — 19:45
Way more common than it should be. Based on your gist and the docs, I think this is one of those cases
h… — 19:48
how do you guys deal with this? maintain a fork or don't use the schema/sdk at all and have your own thing?
Pear — 19:53
we use a messy combination of fetch (of both public endpoints and reverse engineered private ones) / cloudflare sdk

we started experimenting with generating sdks (if you look in our codebase you'll see that for other providers) based on the openapi definitions.

right now the focus is on AWS so we have itty-aws which is our effort to generate an aws sdk based on aws smithy models: https://github.com/alchemy-run/itty-aws

after the aws sdk we are going to look into generating a better cloudflare sdk.
Pear — 19:56
the only realistic solution for how many providers alchemy would like to handle is to generate sdks based on whatever we can and then use some kind of patch system to fix schemas/errors/etc that aren't correct.

if you're doing a one-off thing with the cloudflare api, just use fetch.
h… — 19:57
are you guys accepting/wanting contributions for some cloudflare resources? if you are do you have a preference for which approach to use (for alchemy-effect). otherwise i'll just maintain it in my local fork and do whatever.
Pear — 19:59
yeah we love contributions! depends on what you want to contribute:
for effect alchemy
for generating sdks (aws, cloudflare, etc) I'm responsible so lmk what you're looking to do
for resources / the core engine @sam is responsible so ask him what the best way to contribute is
and @John is working on local emulation (e.g. replacing miniflare)

for non-effect alchemy just make resouces as you see fit and open prs
h… — 20:02
tho this is all very cool (also why replace miniflare?) for me personally adding resources is more important, so i'd prefer helping with that, but i understand that having these API hacks is kinda bad so i understand why are you guys putting that off until you can fix the SDK
Pear — 20:03
we aren't putting anything off until we "fix" the sdks. effect-alchemy resources are currently being made with itty-aws since it mostly works, then we will move to the itty-aws v2 branch once we have that sdk properly generated (we are very close). we can do the same with cloudflare. use fetch/cf's sdk until we have our own then move to that.
Pear — 20:06
we've run into issues with miniflare (e.g. websockets for durable objects having a kind of wonky behavior, random crashes leading to confusing logs, etc). We also want to emulate something that is closer to cloudflare's control plane essentially more akin to a cloudflare version of local stack since we want to make moving between local dev, remote dev, hybrid dev, production deploy a lot more seamless. John can touch on the details more
