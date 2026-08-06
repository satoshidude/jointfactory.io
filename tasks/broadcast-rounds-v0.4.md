# Broadcast: rounds-v0.4

One encrypted Nostr DM per player, sent from `/admin`. Campaign name
**`rounds-v0.4`** — the `dm_log` uses it to stop a double send, so a second run
only picks up whoever is still outstanding.

`{name}` is replaced with the player's display name (or `grower`).

Recipients: 36 accounts, of which 10 were seen in the last 30 days, 3 in the last
90, and 23 longer ago. The dormant ones are the point of a reminder, so the send
goes to all of them.

**One text reaches two very different groups.** Rounds are credited for every
full quadrillion the account ever earned, capped at three:

| credited | accounts |
|---|---|
| 3 rounds, 3 stars | 5 |
| 0 rounds | 31 |

Nobody lands on 1 or 2. An earlier draft promised everyone "3 rounds and 3 stars,
managers at 21 sats instead of 90" — true for five people and worthless for
thirty-one. The text below states the rule instead of the best case, which is the
same correction the switch screen needed.

`/admin` is prefilled with exactly this text and the campaign name — the form
opens ready to go. Sequence: read it, **dry run first**, check the count, type
the campaign name back to unlock, send.

Paragraphs are single lines on purpose. Nostr clients wrap them themselves, and
hard breaks at eighty characters come out ragged on a phone.

---

## Text

```
Hey {name},

Joint Factory runs in rounds now, and your account is waiting for you.

A round ends at one quadrillion joints — about a week with managers and a few visits a day. Counting stops there, you start over, and you keep a star for it. The whole curve was rebuilt around that, so the numbers on your account come from a game that no longer exists. Nothing on it changes until you confirm once, and there is no deadline.

What you are credited: one finished round for every full quadrillion you ever earned, up to three. For most accounts that is none — the old curve ran 169 days and almost nobody reached the end of it. If that is you, nothing is lost: your first star comes from the first round you finish from here, and it is the same race for everyone.

Your sats are not touched. Neither are your deposits, your invite code or your referrals. The wallet stays open without confirming anything — if you would rather withdraw than start over, you can.

What else is new:

- A live race on the Grow page. Every lane runs to the same quadrillion, but the ranking is your projected round time, so starting earlier puts you further along the lane without winning it.
- One standings board with a podium: stars, your best quadrillion, and the joints of the round you are in.
- Managers are hired again each round and get cheaper every time you finish one: 90 sats, then 60, 30, and 21 from the fourth round on. Outdoor, Indoor and Hydroponic stop costing anything after the first, second and third.
- A lottery ticket now asks for one manager bought with sats in the round you are playing. Those sats are the pot you draw from.
- Speed is +5% on the whole chain per step and lasts to the end of the round.
- Six plots all matter now. A new plantation opens at half your highest level, so Greenhouse and MegaFarm are finally worth buying — you need them to finish.

https://jointfactory.io
```

---

## Notes

- No emojis anywhere, per the project's own rule.
- English, like the site.
- Order is deliberate: what happened, that nothing moves without them, what
  confirming is actually worth *for them*, that their money is safe — and only
  then the changelog. Someone who has not opened the game in three months needs
  the call to action, not the feature list.
- The credit rule is stated as a rule, not as a number, because the number is
  zero for thirty-one of thirty-six readers.
