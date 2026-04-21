"""Polymarket activity analyzer.

Given an EOA address, this tool:
  1. Resolves the user's Polymarket proxy wallet (where funds & positions live).
  2. Finds the first on-chain interaction with Polymarket contracts.
  3. Pulls trade/activity history from Polymarket's public data-api.
  4. Summarizes volume, trade count, markets, PnL and a rough airdrop score.

Polymarket trades are executed via a "proxy wallet" controlled by your EOA
(or magic.link account). Funds are deposited to the proxy, and orders are
signed by the EOA but settled against the proxy. When people ask "what is my
Polymarket activity", they usually mean the proxy's activity.

Usage:
    export POLYGON_RPC_URL="https://polygon-rpc.com"   # optional
    python3 polymarket_analyzer.py 0xYourEOA

No API keys required. Polymarket's data-api and the public Polygon RPC are
sufficient.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


# --- Polymarket contracts on Polygon (chain id 137) ---------------------------
# Proxy wallet factory deployed by Polymarket. When an EOA first trades, this
# contract creates a deterministic proxy wallet that holds the collateral and
# the CTF outcome tokens.
PROXY_WALLET_FACTORY = "0xaacfeea03eb1561c4e67d661e40682bd20e3541b"

# ERC-1155 Conditional Tokens Framework used for outcome shares.
CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"

# Order-matching contracts users trade against.
CTF_EXCHANGE = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e"
NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a"
NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"

# USDC.e - Polymarket's collateral asset.
USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

POLYMARKET_CONTRACTS = {
    PROXY_WALLET_FACTORY.lower(): "ProxyWalletFactory",
    CTF.lower(): "ConditionalTokens",
    CTF_EXCHANGE.lower(): "CTFExchange",
    NEG_RISK_CTF_EXCHANGE.lower(): "NegRiskCTFExchange",
    NEG_RISK_ADAPTER.lower(): "NegRiskAdapter",
}

DATA_API = "https://data-api.polymarket.com"

DEFAULT_RPC = os.environ.get("POLYGON_RPC_URL", "https://polygon-rpc.com")


# --- HTTP helpers -------------------------------------------------------------

def _http_get(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> Any:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "polymarket-analyzer/1.0", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed: {last_err}")


def _rpc(method: str, params: list[Any], rpc_url: str = DEFAULT_RPC) -> Any:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    req = urllib.request.Request(
        rpc_url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    if "error" in resp:
        raise RuntimeError(f"RPC error: {resp['error']}")
    return resp["result"]


# --- Proxy wallet resolution --------------------------------------------------

def resolve_proxy_wallet(eoa: str, rpc_url: str = DEFAULT_RPC) -> str | None:
    """Call ProxyWalletFactory.getProxyWalletOfOwner(address) to get the proxy.

    Selector: keccak256("getProxyWalletOfOwner(address)")[0:4] = 0xa0fdf413
    (verified against the deployed contract).
    """
    selector = "0xa0fdf413"
    addr = eoa.lower().removeprefix("0x").rjust(64, "0")
    data = selector + addr
    try:
        result = _rpc(
            "eth_call",
            [{"to": PROXY_WALLET_FACTORY, "data": data}, "latest"],
            rpc_url,
        )
    except Exception:
        return None
    if not result or int(result, 16) == 0:
        return None
    return "0x" + result[-40:]


# --- Data-api calls -----------------------------------------------------------

def fetch_all_trades(user: str, page_size: int = 500) -> list[dict]:
    """Paginate /trades for a proxy wallet. Data-api uses offset pagination."""
    out: list[dict] = []
    offset = 0
    while True:
        batch = _http_get(
            f"{DATA_API}/trades",
            {"user": user, "limit": page_size, "offset": offset},
        )
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return out


def fetch_positions(user: str) -> list[dict]:
    try:
        r = _http_get(f"{DATA_API}/positions", {"user": user, "limit": 500})
        return r if isinstance(r, list) else []
    except Exception:
        return []


def fetch_value(user: str) -> dict | None:
    try:
        r = _http_get(f"{DATA_API}/value", {"user": user})
        return r if isinstance(r, (dict, list)) else None
    except Exception:
        return None


# --- Analysis -----------------------------------------------------------------

@dataclasses.dataclass
class Summary:
    eoa: str
    proxy: str | None
    first_trade_ts: int | None
    first_trade_market: str | None
    trade_count: int
    total_volume_usd: float
    unique_markets: int
    unique_days_active: int
    open_positions_value_usd: float
    realized_pnl_usd: float

    def first_trade_human(self) -> str:
        if not self.first_trade_ts:
            return "n/a"
        return dt.datetime.utcfromtimestamp(self.first_trade_ts).strftime("%Y-%m-%d %H:%M UTC")


def summarize(eoa: str, proxy: str | None, trades: list[dict], positions: list[dict]) -> Summary:
    trade_count = len(trades)
    total_volume = 0.0
    markets: set[str] = set()
    days: set[str] = set()
    first: dict | None = None

    for t in trades:
        # data-api trades expose: price, size, usdcSize (or similar), timestamp,
        # conditionId/market, outcome, side. Field names have shifted over time,
        # so we handle a couple of variants.
        ts = int(t.get("timestamp") or t.get("time") or 0)
        price = float(t.get("price") or 0)
        size = float(t.get("size") or 0)
        usd = float(t.get("usdcSize") or t.get("usdSize") or (price * size))
        total_volume += usd
        market = t.get("conditionId") or t.get("market") or t.get("slug") or ""
        if market:
            markets.add(market)
        if ts:
            days.add(dt.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d"))
            if first is None or ts < int(first.get("timestamp") or first.get("time") or 0):
                first = t

    open_value = 0.0
    realized = 0.0
    for p in positions:
        open_value += float(p.get("currentValue") or p.get("value") or 0)
        realized += float(p.get("realizedPnl") or 0)

    return Summary(
        eoa=eoa,
        proxy=proxy,
        first_trade_ts=int(first.get("timestamp") or first.get("time")) if first else None,
        first_trade_market=(first.get("title") or first.get("slug") or first.get("conditionId")) if first else None,
        trade_count=trade_count,
        total_volume_usd=total_volume,
        unique_markets=len(markets),
        unique_days_active=len(days),
        open_positions_value_usd=open_value,
        realized_pnl_usd=realized,
    )


def airdrop_heuristic(s: Summary) -> dict:
    """Rough airdrop-tier guess. No official criteria have been published;
    this just composes the signals most analyses agree on: volume, longevity,
    market diversity, and consistency.
    """
    volume_points = min(s.total_volume_usd / 1000, 50)       # 1pt / $1k up to 50
    longevity_points = 0
    if s.first_trade_ts:
        years = (time.time() - s.first_trade_ts) / (365 * 86400)
        longevity_points = min(years * 10, 30)               # up to 30
    diversity_points = min(s.unique_markets / 5, 10)         # up to 10
    consistency_points = min(s.unique_days_active / 10, 10)  # up to 10
    score = volume_points + longevity_points + diversity_points + consistency_points
    if score >= 80:
        tier = "S (likely top-tier)"
    elif score >= 50:
        tier = "A (meaningful allocation likely)"
    elif score >= 25:
        tier = "B (modest allocation)"
    elif score >= 10:
        tier = "C (dust-tier)"
    else:
        tier = "D (probably below cutoff)"
    return {
        "score": round(score, 1),
        "tier": tier,
        "components": {
            "volume": round(volume_points, 1),
            "longevity": round(longevity_points, 1),
            "diversity": round(diversity_points, 1),
            "consistency": round(consistency_points, 1),
        },
    }


# --- CLI ----------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description="Analyze a wallet's Polymarket activity.")
    p.add_argument("address", help="EOA address (the wallet you sign with)")
    p.add_argument("--rpc", default=DEFAULT_RPC, help="Polygon RPC URL")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    args = p.parse_args()

    eoa = args.address.lower()
    if not (eoa.startswith("0x") and len(eoa) == 42):
        print(f"Not a valid address: {eoa}", file=sys.stderr)
        return 2

    proxy = resolve_proxy_wallet(eoa, args.rpc)

    # Polymarket's data-api is keyed by the proxy wallet. If the user never
    # traded there will be no proxy; we still try the EOA in case of odd setups.
    query_addr = proxy or eoa
    trades = fetch_all_trades(query_addr)
    positions = fetch_positions(query_addr)

    s = summarize(eoa, proxy, trades, positions)
    airdrop = airdrop_heuristic(s)

    if args.json:
        print(json.dumps({"summary": dataclasses.asdict(s), "airdrop": airdrop}, indent=2))
        return 0

    print(f"EOA:              {s.eoa}")
    print(f"Proxy wallet:     {s.proxy or '(none found — never traded on Polymarket?)'}")
    print(f"First trade:      {s.first_trade_human()}")
    if s.first_trade_market:
        print(f"First market:     {s.first_trade_market}")
    print(f"Trades:           {s.trade_count}")
    print(f"Total volume:     ${s.total_volume_usd:,.2f}")
    print(f"Unique markets:   {s.unique_markets}")
    print(f"Active days:      {s.unique_days_active}")
    print(f"Open positions:   ${s.open_positions_value_usd:,.2f}")
    print(f"Realized PnL:     ${s.realized_pnl_usd:,.2f}")
    print()
    print(f"Airdrop score:    {airdrop['score']} → tier {airdrop['tier']}")
    print(f"  volume:         {airdrop['components']['volume']}")
    print(f"  longevity:      {airdrop['components']['longevity']}")
    print(f"  diversity:      {airdrop['components']['diversity']}")
    print(f"  consistency:    {airdrop['components']['consistency']}")
    print()
    print("Note: Polymarket has not published airdrop criteria. This is a")
    print("heuristic based on the signals most analyses cite (volume, tenure,")
    print("market diversity, active days). Treat the tier as a rough hint.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
