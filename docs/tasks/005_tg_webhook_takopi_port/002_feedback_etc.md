# feedback
## me rambling about your design
ok, i like your design a lot. i just have a few more questions i want to tackle:

1. does it make sense to use cf workflows? it's durable execution and i guess we could make a cron trigger,but honestly i would still prefer webhook. but maybe it would have other benefits? i guess not right now, the webhook -> ... -> container flow is already simple enough for everything we need. and i guess even if we wanted long polling wecould just use cron triggers with workers, and by keeping webhook we minimize our serverless charges

2. the design with the queue was considered worse because the consumer also has to be a worker right? yeah that does make sense... also at this point it's not like we have a lot of jobs we need to buffer and such. but eventually i feel like we will need to implement it because we can't really have backpressure on tg messages right and the jobs are agent runs which can take arbitrarily long. you know what? i feel like we do need to implement queues to avoid some catatrosphe somewhat soon, but let's try a first version without to have less moving parts. i guess in the end we can have a small buffer of messages on the DO?

3. i want the code to be effectful, as always. i want you to discuss how should we interface with telegram? i do know `https://grammy.dev/guide/api` is a very popular typescript framework for telegram which has lots of features, but it seems very object-oriented which's is fineish but i suspect we don't need a lot of those abstractions and we would spend sometime wrapping it around layers etc anyways. what we do need is the type interface for the telegram api, which libraries such as these already have embedded in them. but i guess telegram already exposes a schema for their api and it's reasonably stable so nothing much to worry about really

4. i want to have a good mapping between codex sessions and tg messages etc. also i'd like to expose codex slash commands as telegram slash commands? though i do like the current way things work of threaded replies and loose messages starting fresh contexts, i feel like having an interface more compatible with how the agent clis already works like could be ideal. you can always add the agent to a new chat or just run a slash command to get a new context. but yeah eventually i want to really leverage all the features tg gives us to make good ux: menus, commands, threads etc. but i feel like the ux for threads is not ideal in that you need to select the previous message and reply to it and that feels error prone? but regardless we will have more opportunities to go deep on what the ux should look like. for now let's make the chats really map well to the cli interface with slash commands, so the whole chat is the same context until the user calls /new. and they can always resume sessions by grabbing the id anyways so i feel like this makes sense. i guess we have another layer of abstraction too which is in which container each session is running right? so we have: codex session, tg chats/threads, cf containers. all of which are stateful things we have to map/associate with each other

## next steps

i think we can start working, here are the new spec inputs i need to give you

1. let's be mindful about not dropping messages but also about not triggering boundless work. i think the cheapest place to add a small buffer before we resort to queues is the container do or whatever
2. can we make sure that as long as codex is working the container won't be deprovisioned?
3. i think let's probably not use a telegram framework and just call the api manually with fetch or whatevs and somehow just hard-code the tg bot api types on the package. effectful and testable as always
4. i think we can delete some unused cloudflare package we have, like agent-container and agent-worker i assume. also we can stop naming the other packages takopi. tho i don't know what to call them... i guess we can call them `agent-{container,worker}` ahahah. but i guess even the `takopi-*` code is now useless since we are not going to build the image just by slapping takopi there anymore, it's going to be the new typescript tg bridge there

deliverable:
- clean codebase without legacy
- a simple typescript/effect-only codebase with: iac, worker, container, new tg bridge based on webhook
- ux for tg being similar to codex cli:
    - /new to start a new context
    - keep the message updating thing from takopi that's the nicest feature
    - still send the session id on every message
    - no need to reply in threads anymore (at least for now)
