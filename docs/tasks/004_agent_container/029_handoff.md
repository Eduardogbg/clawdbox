# 004 Agent Container Handoff (029)

## Summary
- User reports Cloudflare containers deprovision after idle; Cloud worker deploy works, but bot still unreliable.
- Need a systematic study of Cloudflare compute offerings and whether any support Telegram polling reliably.

## Key Observations
- Container DOs sleep after `sleepAfter` when no incoming requests; long-polling inside the container does not prevent deprovisioning.
- Workers/DOs have request/CPU limits; long-lived loops are not supported.
- Cron/Alarms can approximate polling, but cadence is limited (minute-level) and not true real-time.
- Telegram webhook is the most native fit for Cloudflare’s request-driven model.

## Open Questions
- Whether Cloudflare Workflows (longer-running) or Queues can be used for near-real-time polling.
- Whether Container DO can be kept alive by scheduled pings, and at what cost.

## Next Steps
1. Produce a concise matrix of CF compute offerings (Workers, DOs, Containers, Workflows, Queues, Cron) vs. suitability for polling.
2. Recommend an architecture (likely webhook or Cron+DO polling) with trade-offs.
