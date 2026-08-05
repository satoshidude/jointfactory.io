# Broadcast: rounds-v0.4

One encrypted Nostr DM per player, sent from `/admin`. Campaign name
**`rounds-v0.4`** — the `dm_log` uses it to stop a double send, so a second run
only picks up whoever is still outstanding.

`{name}` is replaced with the player's display name (or `grower`).

Recipients at the time of writing: 36 accounts, of which 10 were seen in the last
30 days, 3 in the last 90, and 23 longer ago. The dormant ones are the point of a
reminder, so the send goes to all of them.

Sequence in `/admin`: paste the text, name the campaign, **dry run first**, read
the count, type the campaign name back, send.

---

## Text

```
Hey {name},

Joint Factory runs in rounds now.

A round ends at one quadrillion joints — about a week with managers and a few
visits a day. Counting stops there, you start over, and you keep a star for it.
The whole curve was rebuilt around that, so the numbers on your account come from
a game that no longer exists.

Your account is waiting for you to decide. Nothing on it changes until you
confirm, and there is no deadline.

Confirm once and you are credited with 3 rounds and 3 stars. Your managers drop
to the floor price of 21 sats instead of 90, Outdoor, Indoor and Hydroponic never
cost anything again, and round 4 starts on a fresh chain.

Your sats are not touched. Neither are your deposits, your invite code or your
referrals. The wallet stays open without confirming anything — if you would
rather withdraw than start over, you can.

Also new: a live race to the quadrillion on the Grow page, ranked by how long
your round is projected to take rather than by who started first. One standings
board with a podium. Managers get cheaper every round you finish. And a lottery
ticket now asks for one manager bought with sats in the round you are playing —
those sats are the pot you draw from.

https://jointfactory.io
```

---

## Notes

- No emojis anywhere, per the project's own rule.
- English, like the site.
- The three things a player will actually want to know are in the first half:
  what happened, that nothing moves without them, and what confirming is worth.
- The feature list comes last on purpose. Someone who has not opened the game in
  three months needs the call to action, not the changelog.
