read AGENTS.md ; read 000_specs/* ; read a bit of 001_alchemy_effect_cloudflare ; refer to 002_ralphin_time when needed

so we just did 14 iterations of ralph and now i need a normal decent agent to clean up the mess

- for whatever the fucking reason it made a pnpm workspace? figure out if there's any reason for this and try to convert back to bun
- figure out if the tests it wrote are any good, especially the iac ones
- there are somethings (including an iac test) it said it needed docker to use and it couldn't access docker. docker should be available, try to run this test or whatever else uses docker in the project
- we have telegram token (and a sample chat id with the respective bot) now on the secret file `./telegram.json` so whatever tests need telegram we can do them now
- we need and e2e test suite that involves deploying the components there and somehow sending a telegram message?
