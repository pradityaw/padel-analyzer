# Product Backlog - Polymarket Analyzer

## Vision
Transform the Polymarket analyzer from a CLI-only tool into a web application that provides real-time analysis with proper state management and user experience considerations.

## Milestone 1: Core Web Interface & State Management

### Completed
1. ✅ Python CLI implementation with RPC and data-api integration
2. ✅ Proxy wallet resolution
3. ✅ Trade history fetching and pagination
4. ✅ Airdrop scoring heuristic

### In Progress

5. **Web frontend foundation** (Owner: A)
   - Create HTML/CSS/JS interface for wallet analysis
   - Input field for EOA address
   - Display results in user-friendly format

6. **Backend API wrapper** (Owner: B)
   - Flask/FastAPI endpoint that wraps the Python CLI logic
   - RESTful API for /analyze endpoint
   - Async support for long-running analyses

7. **Real-time progress tracking** (Owner: C)
   - WebSocket or SSE for streaming analysis progress
   - Show which step is currently executing (proxy resolution, trade fetch, etc.)

8. **Error handling and retry logic** (Owner: A)
   - Graceful handling of RPC failures
   - User-friendly error messages
   - Retry with exponential backoff for transient failures

9. **Detection quality indicators** (Owner: B)
   - Flag when proxy wallet is not found
   - Warn about incomplete data (API rate limits, timeouts)
   - Show confidence levels in the analysis

10. **Persist "analysis in progress" and low-detection quality signals beyond sessionStorage** (Owners: A + B + C)
    - **Problem**: Currently no web interface exists. When implemented, using sessionStorage means:
      - State is lost on page refresh
      - Deep links don't show the correct state
      - Users who share links see stale/empty state
    - **Solution**: Implement persistent state management:
      - Use localStorage for client-side persistence of analysis results
      - Store analysis job IDs in URL parameters for deep-linking
      - Persist "analysis in progress" status with timestamps
      - Store detection quality warnings (e.g., "proxy not found", "incomplete data")
      - On page load, check for analysis job ID in URL or localStorage
      - Resume/display appropriate state based on persisted data
    - **Acceptance Criteria**:
      - ✓ User can refresh page during analysis without losing progress state
      - ✓ Deep links with job IDs show correct analysis state
      - ✓ Quality warnings persist and display after refresh
      - ✓ Stale states (>24h old) are automatically cleared
      - ✓ Privacy: option to clear stored analyses

11. **Rate limiting and caching** (Owner: C)
    - Cache proxy wallet lookups (EOA -> proxy mapping rarely changes)
    - Implement client-side rate limiting for API calls
    - Show last updated timestamp

12. **Mobile responsive design** (Owner: A)
    - Ensure interface works on mobile devices
    - Touch-friendly interactions

## Milestone 2: Enhanced Features

13. **Multi-wallet comparison** (Owner: TBD)
14. **Historical scoring** (Owner: TBD)
15. **Export to CSV/JSON** (Owner: TBD)
16. **Bookmark/save analyses** (Owner: TBD)

## Milestone 3: Social & Sharing

17. **Share analysis results** (Owner: TBD)
18. **Anonymous leaderboard** (Owner: TBD)
19. **Wallet watching** (Owner: TBD)
