# polymarket-analyzer

Small, no-deps Python CLI that tells you how much you've used Polymarket and
guesses how you'd place in a hypothetical airdrop.

## Why you need to run this locally

This repo was created from a sandboxed assistant session that can't reach
Polygon RPCs or Polymarket's API. Run it on your machine — it only needs
Python 3.11+ and outbound HTTPS.

## Usage

```sh
python3 polymarket_analyzer.py 0xYourEOA
# or with a custom RPC:
POLYGON_RPC_URL="https://polygon.drpc.org" python3 polymarket_analyzer.py 0xYourEOA
# machine-readable:
python3 polymarket_analyzer.py 0xYourEOA --json
```

Example text output:

```
EOA:              0x5486afca53bece46842627c01699f288c7b4dfca
Proxy wallet:     0x...          # the address that actually holds your positions
First trade:      2024-03-12 18:41 UTC
First market:     Will Trump win the 2024 election?
Trades:           173
Total volume:     $18,420.55
Unique markets:   42
Active days:      61
Open positions:   $312.40
Realized PnL:     $-142.30

Airdrop score:    74.3 → tier A (meaningful allocation likely)
  volume:         18.4
  longevity:      21.3
  diversity:      8.4
  consistency:    6.1
```

## What it does

1. Calls `ProxyWalletFactory.getProxyWalletOfOwner(your_eoa)` on Polygon to
   find the proxy wallet Polymarket created for you. Trades and positions
   live on the proxy, not the EOA.
2. Paginates `https://data-api.polymarket.com/trades?user=<proxy>` for your
   full history.
3. Pulls `/positions` to estimate open value and realized PnL.
4. Summarizes first-ever trade, total USDC volume, unique markets, and
   active days.
5. Scores the wallet against a rough airdrop rubric.

## About the airdrop score

Polymarket has confirmed a POLY token and airdrop but has **not** published
eligibility rules. This score is a heuristic: volume (up to 50 pts),
longevity (30), market diversity (10), consistency (10). Most third-party
analyses agree those four signals matter; weights are a guess. Sybil farms
will be filtered — consistent, genuine use beats wash-farmed volume.

## Contracts it looks at

| Contract | Address |
|---|---|
| Proxy Wallet Factory | `0xaacfeea03eb1561c4e67d661e40682bd20e3541b` |
| CTF Exchange | `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` |
| Neg-Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Conditional Tokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| USDC.e (collateral) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
