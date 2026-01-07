i need a canonical thread to use settings commands. we'll eventually need an user system to put api keys and stuff so it's not all charging to mine. also i need visiblity into which containers and sessions are on etc to manage my (and eventually my tenants) cloudflare usage. both in terms of storage compute etc

we need a manager worker/do which has this more normal relation model for settings accounts and such.

make it so i need to have to auth with the cli and paste my codex cli and a cloudflare token. create the token with appropriate permissions for me. make a worker which uses the iac to deploy the dev:env to the user's cf account. you think that's doable? maybe this part needs more speccing.