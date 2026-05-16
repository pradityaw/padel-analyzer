# Technical Strategy - Polymarket Analyzer

## Architecture Overview

### Current State (CLI)
- Pure Python 3.11+ implementation
- No external dependencies (uses only stdlib)
- Direct RPC calls to Polygon
- Synchronous data fetching from Polymarket data-api

### Target State (Web Application)

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (SPA)                       │
│  - Vanilla JS or lightweight framework (< 50KB)         │
│  - No build step required for MVP                        │
│  - LocalStorage + URL params for state persistence      │
└─────────────────────────────────────────────────────────┘
                           │
                           ├─ REST API
                           │
┌─────────────────────────────────────────────────────────┐
│                   Backend (Python)                       │
│  - Flask or FastAPI (async support)                     │
│  - Reuses existing analyzer logic                       │
│  - Optional: Redis for job queue/caching                │
└─────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
┌───────────────────────┐    ┌────────────────────────┐
│   Polygon RPC         │    │  Polymarket Data API   │
│   (Public endpoint)   │    │  (data-api.polymarket) │
└───────────────────────┘    └────────────────────────┘
```

## State Management Strategy

### Problem
Web applications need to maintain state across:
- Page refreshes
- Browser back/forward navigation
- Deep links shared via URL
- Long-running async operations

### Solution: Multi-layer State Persistence

#### 1. **Memory State** (Runtime)
- Active WebSocket connections
- In-flight HTTP requests
- Temporary UI state (modals, dropdowns)

#### 2. **sessionStorage** (Tab-scoped)
- Form input values
- UI preferences for current session
- **DO NOT use for**: analysis results, job status

#### 3. **localStorage** (Cross-session)
- Completed analysis results (with TTL)
- User preferences (theme, default RPC)
- Recent wallet addresses (privacy-aware)
- Quality warning history

#### 4. **URL Parameters** (Deep-linkable)
- `?address=0x...` - EOA being analyzed
- `?job=<uuid>` - Analysis job ID (for in-progress analyses)
- `?view=<section>` - Which section to display

#### 5. **Backend Storage** (Optional for MVP)
- Job queue state (if using Celery/RQ)
- Rate limit counters
- Anonymous usage metrics

### State Schema

```typescript
// localStorage key: `pm-analysis-${address}`
interface AnalysisResult {
  address: string;
  timestamp: number;  // Unix timestamp
  ttl: number;        // 86400 (24h)
  status: 'in_progress' | 'completed' | 'error';
  progress?: {
    step: 'proxy_resolution' | 'trade_fetch' | 'position_fetch' | 'scoring';
    percentage: number;
    message: string;
  };
  qualityWarnings: Array<{
    type: 'proxy_not_found' | 'incomplete_data' | 'rpc_error' | 'api_timeout';
    message: string;
    timestamp: number;
  }>;
  summary?: {
    eoa: string;
    proxy: string | null;
    trade_count: number;
    total_volume_usd: number;
    // ... rest of summary fields
  };
  airdrop?: {
    score: number;
    tier: string;
    components: Record<string, number>;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

### Implementation Guidelines for Item #10

#### On Page Load:
1. Parse URL for `?address=` or `?job=` parameters
2. If `job` param exists:
   - Check localStorage for `pm-job-${job}`
   - If found, restore state (in_progress or completed)
   - If in_progress, poll backend for status updates
3. If `address` param exists:
   - Check localStorage for `pm-analysis-${address}`
   - If found and not stale (< 24h), display cached results
   - If stale, clear and optionally auto-refresh
4. Clean up stale localStorage entries (> 24h old)

#### During Analysis:
1. Generate unique job ID (UUID v4)
2. Update URL with `?job=${jobId}&address=${address}`
3. Store initial state in localStorage:
   ```javascript
   localStorage.setItem(`pm-job-${jobId}`, JSON.stringify({
     address,
     status: 'in_progress',
     timestamp: Date.now(),
     progress: { step: 'proxy_resolution', percentage: 0 }
   }));
   ```
4. As progress updates arrive (WebSocket/polling):
   - Update localStorage entry
   - Update UI
   - Keep in sync

#### On Completion:
1. Update job status to 'completed'
2. Store full results under `pm-analysis-${address}`
3. Keep job reference for 1 hour (for refresh scenarios)
4. Remove from URL: `history.replaceState(null, '', `?address=${address}`)`

#### Quality Warnings:
```javascript
// Persist warnings as they occur
function addQualityWarning(address, warning) {
  const key = `pm-analysis-${address}`;
  const data = JSON.parse(localStorage.getItem(key) || '{}');
  data.qualityWarnings = data.qualityWarnings || [];
  data.qualityWarnings.push({
    ...warning,
    timestamp: Date.now()
  });
  localStorage.setItem(key, JSON.stringify(data));
}

// Display warnings on page load
function showQualityWarnings(address) {
  const data = JSON.parse(localStorage.getItem(`pm-analysis-${address}`));
  if (data?.qualityWarnings?.length > 0) {
    // Show persistent banner/toast with warnings
    displayWarningBanner(data.qualityWarnings);
  }
}
```

#### Privacy & Cleanup:
```javascript
// Auto-cleanup on page load
function cleanupStaleAnalyses() {
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000; // 24h
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('pm-analysis-') || key.startsWith('pm-job-')) {
      const data = JSON.parse(localStorage.getItem(key));
      if (data.timestamp && (now - data.timestamp > TTL)) {
        localStorage.removeItem(key);
      }
    }
  }
}

// Manual clear button
function clearAllAnalyses() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('pm-'))
    .forEach(k => localStorage.removeItem(k));
}
```

## Technology Choices

### Frontend
- **Option A (Recommended for MVP)**: Vanilla JS + HTML + CSS
  - No build step
  - Fast loading
  - Easy deployment (static hosting)
  - ~5KB gzipped

- **Option B**: Lightweight framework (Preact, Alpine.js)
  - Better state management
  - Component reusability
  - ~10-15KB overhead

### Backend
- **Option A (Recommended)**: Flask + flask-cors
  - Simple, battle-tested
  - Easy to wrap existing code
  - Good enough async support with gevent

- **Option B**: FastAPI
  - Native async/await
  - Better WebSocket support
  - Auto-generated API docs

### Deployment
- **Frontend**: Netlify, Vercel, Cloudflare Pages (all have free tiers)
- **Backend**: 
  - Heroku (free tier)
  - Railway
  - Fly.io
  - DigitalOcean App Platform

## Security Considerations

1. **No Private Keys**: Never ask for or store private keys
2. **Read-Only**: All RPC calls are read-only (eth_call)
3. **Rate Limiting**: Protect backend from abuse
4. **CORS**: Whitelist only production domain
5. **Input Validation**: Validate all addresses server-side
6. **Privacy**: 
   - Don't log addresses permanently
   - Clear localStorage option
   - Optional: don't send addresses to backend (client-only mode)

## Performance Targets

- Time to First Byte (TTFB): < 200ms
- Full analysis completion: < 5s for typical wallet
- Frontend bundle: < 50KB gzipped
- Lighthouse score: > 90

## Testing Strategy

- Unit tests: Python analyzer logic (already implicitly tested)
- Integration tests: Backend API endpoints
- E2E tests: Critical user flows (analyze, refresh, deep-link)
- Browser testing: Chrome, Firefox, Safari (last 2 versions)
