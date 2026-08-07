# Stacker.news post — draft

Territory: `~bitcoin_beginners` or `~builders` (SN has no games territory; `~builders`
fits the "I built this" framing best).

Numbers checked against live on 2026-08-07: 11 350 sats deposited, 808 withdrawn,
draws Tue/Thu/Sat 21:00 Berlin, four tickets per draw at 10/18/28/44 % of a day's
output, boosts 10 and 21 sats, managers 90/60/30/21 by round.

No emojis, per the project's own rule.

---

## Title

**I built an idle game where the lottery pot is only what players actually spent**

---

## Body

Joint Factory is an idle game on Lightning and Nostr. You grow, haul and roll,
the numbers go up, and a lottery pays out real sats three times a week. It has
been running for a few months, it is small, and I just shipped the change that
made it a game instead of a graph: rounds.

**No account.** Nostr login, NIP-07 or a pasted nsec. No email, no password, no
signup form. Guests can play the whole chain — the three managers that automate
it are free for everyone, so nobody has to deposit anything to find out whether
they like it.

**Nothing mints sats.** Every credited sat is backed by a deposit or a pot
payout, tracked in a house ledger and checked hourly. Deposits are LNbits
invoices, withdrawals are LNURL. Right now: 11 350 sats in, 808 out, and the
ledger says what backs what. If the game cannot pay, the number that says so is
a GET request away.

**The pot is not seeded.** It is exactly what players spent on boosts and
managers, gross — the house cut is taken once, at payout, and nowhere else. Four
tickets per draw, priced at 10, 18, 28 and 44 percent of a day of your own
production. That means the four together are one day of output whether you make
a joint a second or ten billion: the leader and a beginner pay the same, in the
only unit that stays comparable. 80 percent goes to the winners, split by rank,
and the number of winners is a third of the entrants.

**A round ends.** This is the part I got wrong for a long time. The old curve ran
to a quadrillion in 169 days and then nowhere — the players at the top had
nothing left to do and the numbers had stopped meaning anything. Now a round
finishes at a quadrillion, counting stops there, and starting over banks a star.
About a week with managers and a few visits a day. Sats survive a reset; nothing
else does, and a star buys no advantage of any kind, which is what keeps the
times comparable between rounds.

The thing I did not expect: making the goal reachable is what made the last two
plantations worth buying. When the curve ran forever, levelling the plot you
already had was always the better purchase, and only months of runway ever got
anyone to the end of the ladder.

**Where it runs.** One VPS, SQLite, Fastify, no cloud anything. The Nostr bot
posts winners and reminders through my own relay. Source is on GitHub.

Alpha, and I mean it: deposit small amounts or none at all. It is an art and
education project about what a game looks like when the money is real and the
operator cannot print it.

https://jointfactory.io
github.com/satoshidude/jointfactory.io

---

## Notes

- The hook is the pot, not the game. On SN, "an idle game" is a scroll-past;
  "the pot is only what players spent" is a claim someone will want to check.
- Every number in the post is verifiable from the live endpoints, which is the
  point of naming them.
- No screenshots in the draft — SN posts do fine without, and a link preview
  carries the OG image.
