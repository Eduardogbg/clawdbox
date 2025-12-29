alchemy discord conversation about cloudflare sdk. i'm "h.." (discord is bugged lol)

## transcript
h… — 10:30
yo @sam can i help with cloudflare resources? i'm mostly aiming at secrets store and containers. for secrets store the api schema is wrong so i would use fetch i assume?
sam — 10:48
PRs are very much welcome. If you've found problems, please don't hesitiate to contribute fixes/changes!
h… — 10:53
would this be the correct approach? to use fetch for a resource where the SDK is wrong?
sam — 10:53
we use fetch for pretty much everything right now
Use the createCloudflareApi(props) helper
that gives you authenticated fetch with our defaults applied
h… — 10:54
got it thanks!