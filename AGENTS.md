# AGENTS.md

## Cursor Cloud specific instructions

This is a **single-file Python CLI** (`polymarket_analyzer.py`) with **zero third-party dependencies**. It uses only the Python standard library.

### Running the tool

```sh
python3 polymarket_analyzer.py <EOA_ADDRESS>
python3 polymarket_analyzer.py <EOA_ADDRESS> --json
python3 polymarket_analyzer.py <EOA_ADDRESS> --rpc https://polygon.drpc.org
```

The tool requires outbound HTTPS to two external services:
- **Polygon JSON-RPC** (default `https://polygon-rpc.com`, override via `POLYGON_RPC_URL` env var or `--rpc` flag)
- **Polymarket Data API** (`https://data-api.polymarket.com`, no API key needed)

### Linting

```sh
python3 -m py_compile polymarket_analyzer.py   # syntax check
flake8 polymarket_analyzer.py --max-line-length=120
mypy polymarket_analyzer.py --ignore-missing-imports
```

Note: `mypy` reports 3 pre-existing type errors (return-value, arg-type, assignment) that do not affect runtime behavior.

### Testing

There are no automated tests in this repo. Validation is done by running the CLI against a real Ethereum address and verifying the output structure and exit code.

### Gotchas

- The default public Polygon RPC (`polygon-rpc.com`) has rate limits. If you see `RPC error` or timeouts, set `POLYGON_RPC_URL` to a premium provider (Alchemy, Infura, dRPC).
- The example address in the README (`0x5486afca53bece46842627c01699f288c7b4dfca`) returns zero trades — it has no Polymarket proxy wallet. Use a known active Polymarket trader address for richer output.
