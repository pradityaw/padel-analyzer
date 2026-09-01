# Mobile App Review — Padel Analyzer

> Comprehensive review of `/mobile` (Expo / React Native), branch `feat/mobile-record-mode-ui` · June 2026
>
> Companion to [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) (web). Two passes:
> Part A — correctness + architecture. Part B — UI/UX, design system (Court Flood), accessibility.
> All findings verified against actual code with file:line references.

---

# Part A — Correctness & Architecture

## Architecture assessment

The mobile app holds to its "thin client" contract well: a single REST upload endpoint plus an untyped tRPC client, React Query for all server state, no on-device inference, and zero imports from `shared/` (mirrored constants are explicitly annotated in `api.ts` and `recordMode.ts`). The screen layer is clean native-stack navigation with typed route params, and the lib layer (`ballTracking.ts`, `courtCorners.ts`, `recordMode.ts`) is defensively written with good input validation. However, the untyped tRPC client has already produced exactly the failure mode it invites: the most recent commit (b251fc6) changed the `analysis.getById` server contract (`includeLandmarks` flag, default `false`), updated the web client, and silently broke the mobile app's core feature — skeleton replay — with no compile-time signal. There is also a substantial amount of dead code targeting server procedures that do not exist (`analysis.getCvStatus`, `analysis.triggerCvPipeline`), near-verbatim duplication of the upload flow between Home and Upload screens, and React Query is used without wiring `focusManager`/`onlineManager` to AppState, so its refetch-on-focus semantics are inert in React Native. Overall: structure is sound, hygiene is good, but contract drift against the server is the live, recurring risk.

## Findings

| # | Severity | Location | Finding | Fix |
|---|---|---|---|---|
| A1 | **Critical** | `mobile/src/lib/api.ts:140-144` | `getAnalysisById` calls `analysis.getById` with `{ id }` only. Commit b251fc6 added `includeLandmarks` (default `false`) to the server (`server/routers/analysis.ts:57-98`), which now returns `landmarksJson: "[]"` and `ballTracking: []` unless the flag is passed. Web client was updated (`client/src/pages/Analysis.tsx:40`); mobile was not. **Skeleton replay and ball overlay are broken for every real (non-demo) analysis** — the headline beta feature. Verified by diffing `b251fc6^` (old getById returned landmarks unconditionally). | Pass `includeLandmarks: true` in the query input. |
| A2 | **High** | `mobile/src/screens/AnalysisScreen.tsx:144-152` | `useFocusEffect(useCallback(..., [isDemo, query, cvPoll, cvStatus]))` — `query`/`cvPoll` are `useQuery` result objects, recreated every render. The focus effect therefore re-runs (and calls `query.refetch()`) on **every render while focused**. During video replay, `setPlaybackMs` (line 348) re-renders ~2×/sec → a network refetch of the full analysis (incl. landmarks once A1 is fixed, a large payload) every playback tick. | Depend only on stable values: `[isDemo, analysisId, query.refetch, cvStatus]` (refetch is referentially stable in RQ v5). |
| A3 | **High** | `mobile/src/screens/AnalysisScreen.tsx:220-227` + `mobile/src/lib/ballTracking.ts:71-93` | Ball samples arrive in **image-pixel space** (`image_x/image_y` passed through raw by `server/lib/ballTracking.ts:60-87`), but mobile normalizes them against the **rendered layout size** (`videoSize` from `onLayout`, default 320×180). For a 1080p video in a ~360pt view, x=1500/360≈4.2 → fails the 0–1 range check and is silently dropped, so the ball overlay/speed badge never renders for pixel-space data; near-misses render misplaced. Web correctly uses intrinsic `video.videoWidth/videoHeight` (`client/src/components/VideoPlayer.tsx:368`). | Read intrinsic dimensions from expo-av's `onReadyForDisplay` (`naturalSize`) and use those as the normalization denominator. |
| A4 | **Medium** | `mobile/src/screens/JobStatusScreen.tsx:45-55` | `handleRetry` swallows errors: `catch (err) { query.refetch(); }`. The server's retry procedure throws actionable messages, e.g. "Original video is no longer available. Upload the clip again." (`server/routers/mobileAnalysis.ts:230-239`). User taps Retry, spinner resets, nothing happens, no explanation. | Store `err.message` in state and render it. |
| A5 | **Medium** | `mobile/src/lib/courtCorners.ts:58-60`, `mobile/src/screens/RecordScreen.tsx:151` (called as `void confirmAlignment()` at :399), `mobile/src/screens/SetupWizardScreen.tsx:97` (via `onPress={goNext}` :163 and `void goNext()` :235) | `saveCourtCorners` calls `AsyncStorage.setItem` **unguarded** — unlike `saveLastRecordMode`, which was hardened in commit bad8097. A storage failure becomes an unhandled promise rejection; in RecordScreen the user is stuck on the "aligning" stage with no error, and in the wizard `goNext` silently stops advancing. | Wrap in try/catch (non-critical persistence must not block the flow), matching `recordMode.ts:49-55`. |
| A6 | **Medium** | `mobile/src/screens/JobStatusScreen.tsx:35-40` + `mobile/App.tsx:36` + `mobile/src/screens/HomeScreen.tsx:68-71` | Cache never invalidated after a job completes: JobStatus replaces to Analysis without touching `["mobile-analyses"]`; Home is the stack root so it never remounts/refetches; and `focusManager`/`onlineManager` are not wired to AppState/NetInfo, so `refetchOnWindowFocus`/`refetchOnReconnect` never fire in RN. New analyses appear in "Recent analyses"/History only via manual pull-to-refresh. | `queryClient.invalidateQueries({ queryKey: ["mobile-analyses"] })` when status flips to `completed`; wire `focusManager.setFocused` to `AppState` in App.tsx. |
| A7 | **Medium** | `mobile/src/lib/api.ts:84-102` | Upload `fetch` has no timeout or AbortController. A stalled LAN upload (common failure mode this codebase explicitly targets — see error copy at :96-99) leaves UploadScreen/RecordScreen/HomeScreen showing "Uploading…" indefinitely with the buttons disabled. No progress reporting for 30s/up-to-2GB clips either. | Use `expo-file-system` `uploadAsync` (progress + cancellation) or an AbortController timeout. |
| A8 | **Medium** | `mobile/src/lib/api.ts:146-169`, `mobile/src/screens/AnalysisScreen.tsx:41-42, 124-181, 494-563`, `mobile/src/lib/types.ts:96-168` | Dead code targeting **nonexistent server procedures**: `analysis.getCvStatus` and `analysis.triggerCvPipeline` appear nowhere in `server/routers/` (verified by grep), and `AnalysisDetail.cvStatus/cvResult` are never returned by `analysis.getById`. ~250 lines (cvPoll, auto-trigger effect, `runMatchCv`, `MobileHeatmap`, `collectHeatmapPlayers`, condensed-video toggle, CV types) are gated behind `MATCH_CV_ENABLED = false`. The blanket `catch → {null, null}` in `getCvStatus` would also mask real network errors if ever enabled. | Delete or quarantine until the server pipeline lands; re-verify procedure names then. |
| A9 | **Medium** | `mobile/src/screens/HomeScreen.tsx:73-111` vs `mobile/src/screens/UploadScreen.tsx:52-90` | `runUpload`, `handlePickFromPhotos`, `handlePickFromFiles` duplicated near-verbatim (only `navigate` vs `replace` differs). Two error-handling paths to keep in sync. | Extract a `useSwingUpload(navigation)` hook. |
| A10 | **Medium** | `mobile/src/screens/JobStatusScreen.tsx:27-32` | Polling never terminates on failure modes other than completed/failed: if `getProgress` returns `null` (job not found — screen even renders "Analysis job not found" at :139) or the server is unreachable, the 1.5s interval (plus RQ default retries) runs forever for as long as the screen is mounted. | Return `false` from `refetchInterval` when `data === null`, and back off on `query.isError`. |
| A11 | Low | `mobile/src/screens/AnalysisScreen.tsx:122` | `getDemoAnalysisDetail()` is called on every render in demo mode, and the demo interval (:205-211) re-renders every 66ms — regenerating 48 frames + two `JSON.stringify` calls per tick; `createdAt: new Date()` makes the header date tick live. | `useMemo(() => getDemoAnalysisDetail(), [isDemo])`. |
| A12 | Low | `mobile/src/screens/RecordScreen.tsx:130-136, 162-201` | Countdown is not cancellable: `runCountdown`'s `sleep` chain keeps resolving after the user leaves the screen; `setStage`/`setCountdown`/`recordAsync` run against an unmounted component (benign no-op via the null ref optional chain, but a cancelled-ref guard would make the lifecycle explicit). No way for the user to abort during the 3s countdown either. | Add an `isActiveRef` checked after each `sleep`; render a cancel button in countdown stage. |
| A13 | Low | `mobile/src/lib/api.ts:108-112` | `(await response.json()) as UploadResponse` — neither JSON parse failure nor a missing `storageKey` is guarded; an undefined key flows into `mobileAnalysis.create` and surfaces as a raw Zod error. Server contract verified at `server/_core/index.ts:59`. | Validate `typeof uploaded.storageKey === "string"` and throw a friendly error. |
| A14 | Low | `mobile/src/screens/HistoryScreen.tsx:97` | Header reads "Your sports schedule" — leftover copy from the Fixtured design template, nonsensical for an analysis-history screen. | Change to "Your sessions" / "Your progress". |
| A15 | Low | `mobile/CLAUDE.md:57` | Doc drift: says JobStatusScreen polls `mobileAnalysis.getById`; it actually polls `mobileAnalysis.getProgress` (`api.ts:124-128`). Risky doc to be wrong given the untyped client is hand-matched against names. | Update the doc. |
| A16 | Low | `mobile/mobile/` | Stray nested directory (`package.json` with only a `xcode` devDependency + `node_modules` + lockfile) from an `npm install` run in the wrong cwd. Untracked, local-only debris. | Delete; consider adding to `.gitignore` defensively. |
| A17 | Low (unverified reachable) | `mobile/src/screens/RecordScreen.tsx:67-77` | `recordMode`, `stage`, and `hasCourtAlignment` are captured from `route.params` via `useState` initializers only — if Record were re-targeted via `navigation.navigate` with different params while already mounted, they'd be stale. Current flows always push/replace a fresh instance, so not reachable today. | Use `useEffect` on `route.params` if re-navigation is ever added. |

Notes, not ranked: app backgrounding during recording is handled implicitly (the `recordAsync` rejection lands in the try/catch at RecordScreen.tsx:194-200) — acceptable for beta; server defaults `mode` to `"match"` when omitted (`mobileAnalysis.ts:58`) while mobile defaults to `"rally"` — mobile always sends a mode so no live mismatch, but the mirror constants disagree on the implicit default.

## What's done well (Part A)

- **Defensive parsing everywhere it matters**: `parseBallTrackingSamples`/`isFiniteTuple` (`ballTracking.ts`) reject malformed tuples; `phasesJson`/`landmarksJson` parsed inside try/catch with array guards (AnalysisScreen, CompareScreen); `loadSavedCourtCorners` validates shape and 0–1 ranges before trusting AsyncStorage.
- **Upload error UX is genuinely good**: `api.ts` distinguishes network failure vs HTTP status, extracts server JSON error bodies, and gives actionable LAN-specific guidance (firewall, Local Network permission, IP/port).
- **Query key discipline**: `["mobile-analyses"]` prefix invalidation from HistoryScreen delete and LoginScreen logout correctly covers Home/History/Compare variants; JobStatus `refetchInterval` correctly stops on terminal states and the retry→new-job-id flow (`setJobId`) re-keys the poll cleanly.
- **Timer/interval hygiene**: every `setInterval` has a cleanup; RecordScreen stops an active recording on unmount via `recordingActiveRef`.
- **Mirror-constant annotations** (`MAX_UPLOAD_BYTES`, `RECORD_MODES`) explicitly document the shared/ divergence risk, and `normalizeCourtCornersForApi` exists specifically to satisfy the server's Zod int constraints — the contract is at least thought about, even if finding A1 shows it needs a smoke test (e.g. assert non-empty `landmarksJson` for a known-good analysis in CI).

---

# Part B — UI/UX, Design System (Court Flood) & Accessibility

Scope: `mobile/App.tsx`, all 11 screens in `mobile/src/screens/`, all 5 components in `mobile/src/components/`, `mobile/src/lib/theme.ts`, audited against `design.md` ("Court Flood", locked 2026-06-10).

## 1. Design-system fidelity summary

**Verdict: high fidelity.** `mobile/src/lib/theme.ts` mirrors the design.md token table hex-for-hex (paper `#0a0f2e`, surface `#131a40`, flood `#2b3fbd`, ink/ink-2/muted, accent `#5b8cff`, cta white, sand `#e8c468`) plus the card-paper ledger tokens from DNA #9, and `radius = { card: 16, pill: 999, input: 12 }`. Every screen imports `theme`/`radius`; zero legacy Tennis Neon remnants in code — a grep for `#0f172a`, `#a3e635`, `1e293b`, `334155`, `94a3b8`, `bef264` returns **nothing**. The old theme is fully superseded.

**Complete list of hardcoded colors that should be tokens** (the only ones in the codebase):

| File:line | Value | Should be |
|---|---|---|
| `RecordScreen.tsx:592` | `#dc2626` (stop button) | new `theme.dangerStrong` token (existing `theme.danger #f87171` is too light for a filled button) |
| `RecordScreen.tsx:536` | `rgba(220,38,38,0.85)` (recording badge) | same `dangerStrong` token |
| `RecordScreen.tsx:546,549,598` | `#fff` ×3 | `theme.cta` / `theme.ink` |
| `CourtAlignmentOverlay.tsx:62,63,100,101` | `#ec4899` / `rgba(236,72,153,…)` ×4 (court box) | a named `theme.courtMarker` token — pink appears nowhere in design.md |
| `SkeletonPreview.tsx:53` | `#ffffff` (pose dots) | `theme.ink` (AnalysisScreen:384 correctly uses `theme.ink` for the identical dots — internal drift) |
| `RecordScreen.tsx:476,604`, `SetupWizardScreen.tsx:258` | `#000` (camera letterbox) | acceptable, but `theme.raised` would be consistent |
| `RecordScreen.tsx:500,523`, `SetupWizardScreen.tsx:266`, `AnalysisScreen.tsx:734,743`, `SkeletonPreview.tsx:87` | scrim `rgba(7,11,34,0.75–0.90)` | these are raised-with-alpha; add `theme.scrim` (repeated 6×) |
| `AnalysisScreen.tsx:83` | `rgba(91,140,255,…)` heatmap | derived from accent — fine as data encoding, but hardcodes the accent hex |

**Gaps vs. spec:** (a) **Typography tokens are entirely absent on mobile** — design.md mandates Archivo Variable condensed display + Geist body, exported via `mobile/src/lib/theme.ts`; theme.ts has no font tokens, no `expo-font`/`useFonts` anywhere, no `fontFamily` in any style. Screens approximate with system font `fontWeight:"800"` + uppercase + letterSpacing — a reasonable RN fallback but undocumented and un-tokenized. (b) **`mobile/CLAUDE.md:81` is stale**: "Dark theme: `#0f172a` bg, `#a3e635` accent" still documents the retired system and will mislead future code generation.

## 2. Severity-ranked findings

| # | Sev | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| B1 | **High** | `HistoryScreen.tsx:173, 286` | **Invisible empty state.** "No analyses yet" uses `styles.cardTitle` → `color: theme.cardPaperInk` (`#0a0f2e`) rendered on `theme.paper` (`#0a0f2e`) — identical hex, 1:1 contrast. The empty state is literally unreadable. Subtext (`metaText` → `cardPaperMuted #5a6280` on paper) is ~3.1:1, also failing. | Add dedicated `emptyTitle`/`emptyMeta` styles using `theme.ink`/`theme.ink2` (cardTitle/metaText are styled for the light card-paper rows, not the dark page). |
| B2 | **High** | `HistoryScreen.tsx:97` | **Copy leaked from the studied source.** Title reads "Your sports schedule" — that is the Fixtured schedule-app concept's content, not this product's. Violates design.md's own soft-refusal rule (DNA extracted, content not reproduced). | "Your sessions" / "Session history". |
| B3 | **High** | `HomeScreen.tsx:283-297`, `HistoryScreen.tsx:166-179`, `ProCompareScreen.tsx:76-87` | **No error state on any list screen.** None checks `isError`; on network failure `data` is undefined → falls into the "No analyses yet" empty state. User with 50 sessions and a dropped Wi-Fi sees "No analyses yet — upload a swing" with no retry. (Contrast: `JobStatusScreen.tsx:71-75` does this correctly.) | Add an `isError` branch with the JobStatus-style message + a Retry button calling `refetch()`. |
| B4 | **High** | app-wide (verified by grep) | **Accessibility props on exactly 1 of ~30 touchables.** Only `HomeScreen.tsx:174-175` has `accessibilityRole`/`accessibilityLabel`. Every other `Pressable` (all CTAs, NavGrid tiles, History rows, Compare toggles, Record controls) lacks `accessibilityRole="button"`; selected states (`CompareScreen.tsx:119-136` toggles, `SetupWizardScreen.tsx:184-196` mode cards) lack `accessibilityState={{ selected }}`; the recording timer (`RecordScreen.tsx:379-385`) and countdown (`:372-376`) are not announced. | Sweep: `accessibilityRole="button"` everywhere, `accessibilityState` on toggles, live-region on recording timer + countdown. |
| B5 | **High** | `HistoryScreen.tsx:125-131` + `:52-78` | **Delete is long-press-only and undiscoverable** — no visible affordance, no `accessibilityActions`, so VoiceOver/TalkBack users cannot delete at all. | Add a swipe action or visible "…" button, plus `accessibilityActions=[{name:'delete'}]` with `onAccessibilityAction`. |
| B6 | **Med** | `SetupWizardScreen.tsx:109-115` | **Silent permission failure.** `goNext()` wraps `ensurePermissions()` in `catch { return; }` — tapping "Next" toward the align step with camera denied does *nothing*: no message, no Settings hint. Looks like a dead button. | Surface the error (state + text under footer) and offer `Linking.openSettings()`. |
| B7 | **Med** | `RecordScreen.tsx:117-118, 125-126, 250-277` | **Permission-denied dead end.** When `canAskAgain` is false, "Allow camera" silently fails (the OS won't re-prompt) and the error text says "Enable Camera in Settings" with no way to get there. Mic denial never gets a dedicated screen — only camera is gated (`:250`); mic failure surfaces only as an error string after tapping record. | Check `canAskAgain`; render an "Open Settings" button using `Linking.openSettings()` (no `Linking` import exists anywhere — verified). Extend the gate screen to mic. |
| B8 | **Med** | `RecordScreen.tsx:103-110` | **Navigation away mid-recording silently discards the take.** Unmount cleanup calls `stopRecording()` (good — no orphaned session), but there is no `beforeRemove` guard, so the iOS back-swipe during a 30s rally kills the clip with zero confirmation. design.md: "Destructive actions confirm before acting." | Add `navigation.addListener("beforeRemove", …)` that `e.preventDefault()`s during `recording`/`preview` stages and shows a confirm Alert. |
| B9 | **Med** | `HistoryScreen.tsx:204-211` + `:248-254` | **Two flood surfaces in one viewport** — the KPI `statRow` (`backgroundColor: theme.flood`) and the `featuredCard` (`theme.flood`) are both visible at the top of the list. design.md hard rule: "at most one flood surface per viewport… never several." (Ironically both carry comments claiming to be "the one flood surface".) | Make the KPI strip `theme.surface` (or drop the featured flood). |
| B10 | **Med** | `HistoryScreen.tsx:156-161, 300-310` + `RecordModeBadge.tsx:19-21` | **Badge contrast fails on light ledger rows.** Non-featured rows use light `cardPaper #eef1f8`, but `styles.badge` and `RecordModeBadge` use `white10` bg + `ink2 #aab3d6` text — ~1.8:1 on the light card. | Add a `variant="light"` to the badge (e.g. `cardPaperMuted` text on `rgba(10,15,46,0.06)`). |
| B11 | **Med** | `LoginScreen.tsx:75-135` | **No keyboard avoidance** on the only input screen — no `KeyboardAvoidingView`, no `keyboardShouldPersistTaps`; on small iPhones the keyboard covers "Send magic link", and tapping the button first dismisses the keyboard. | Wrap in `KeyboardAvoidingView behavior="padding"` + `keyboardShouldPersistTaps="handled"` on the ScrollView. |
| B12 | **Med** | `RecordScreen.tsx:554-559, 606-612`; `SetupWizardScreen.tsx:329-334` | **Bottom control bars ignore the safe-area bottom inset.** `SafeAreaProvider` is mounted (`App.tsx:54`) but no screen calls `useSafeAreaInsets`/`SafeAreaView` (verified by grep). On home-indicator iPhones the Stop/Record/Continue buttons sit in the gesture zone. | `paddingBottom: 16 + insets.bottom` via `useSafeAreaInsets()`. |
| B13 | **Med** | `CourtAlignmentOverlay.tsx:13, 67-85` | **Drag handles are 28pt** (< 44pt minimum) with no `hitSlop`, and have no accessibility role/label/value — court alignment is impossible non-visually and fiddly for everyone. | `HANDLE_SIZE` 44 (keep visual dot smaller inside) or `hitSlop={12}`; add `accessibilityRole="adjustable"` with labels ("Top-left court corner"). |
| B14 | **Med** | `RecordScreen.tsx:83-84` | `Dimensions.get("window")` is read at render, not subscribed — after the user follows the "Rotate to landscape" hint, no re-render fires, so the hint can stay (or disappear) incorrectly until some other state changes. | `useWindowDimensions()`. |
| B15 | **Med** | `AnalysisScreen.tsx:285-291` | Query **error and not-found are conflated**: any network failure renders "Analysis not found" with no retry. | Branch on `query.isError` → "Couldn't load analysis" + Retry. |
| B16 | **Med** | `SkeletonPreview.tsx:14-19`, `AnalysisScreen.tsx:205-211` | **Reduced motion ignored.** Both skeleton animations run an unconditional 66ms `setInterval` (15fps, infinite). design.md: "Reduced motion: collapse to ≤150ms opacity crossfade." No `AccessibilityInfo.isReduceMotionEnabled` anywhere (grep-verified). Also a battery drain on the Home hero. | Gate with `AccessibilityInfo.isReduceMotionEnabled()` + change listener; render a static frame when on. |
| B17 | **Med** | `CompareScreen.tsx:140-162` | **No empty and no error state** for the session list: with zero sessions (or a failed fetch) the picker renders the slots card and then… nothing. | Add empty ("No sessions to compare — analyze a swing first") and error branches. |
| B18 | **Med** | `mobile/CLAUDE.md:81` | Stale doc: "Dark theme: `#0f172a` bg, `#a3e635` accent" contradicts the locked Court Flood system. | Update to point at `src/lib/theme.ts` / design.md. |
| B19 | **Low** | `HomeScreen.tsx:366-369`; `SetupWizardScreen.tsx:228-230` | Small touch targets: "Skip setup → camera" (`paddingVertical: 4` ≈ 25pt) and wizard "Skip setup" (bare `Pressable`, ≈16pt). `CompareScreen.tsx:219-226` toggles ≈ 37pt. | `minHeight: 44` / `hitSlop`. |
| B20 | **Low** | `JobStatusScreen.tsx:50-52` | Retry failure is swallowed (`catch` → `refetch()`, no message) — button flashes "Retrying…" then nothing. (Same as A4.) | Set an error string state. |
| B21 | **Low** | `RecordScreen.tsx:208-213` | "Retake" discards the clip with no confirm (design.md: destructive confirms). Borderline since re-recording is cheap, but a 30s rally is real effort. | Confirm when clip length > ~10s. |
| B22 | **Low** | `theme.ts:11` usage, e.g. `UploadScreen.tsx:193-199` | `theme.muted #6b75a3` on paper ≈ 4.2:1 — slightly below 4.5:1 for the 10–11px section labels it's used on (bold/uppercase mitigates). | Use `ink2` for ≤11px labels or lighten muted one step. |
| B23 | **Low** | `RecordScreen.tsx:130-136, 171-172` | Countdown `sleep()` loop isn't cancelled on unmount (same as A12). | Track mounted/abort flag in the loop. |

## 3. Per-screen state-coverage matrix

| Screen | Loading | Empty | Error | Notes |
|---|---|---|---|---|
| Home | ✅ (spinner in list, `:284-288`) | ✅ (`:290-296`) | ❌ shows fake "No analyses yet" | upload errors ✅ (`:224`) |
| Upload | ✅ (button + spinner) | n/a | ✅ (`:123`) | solid |
| SetupWizard | n/a | n/a | ❌ silent permission failure (`:109-115`) | |
| Record | ✅ (permission resolving `:242-248`) | n/a | ✅ banners (`:257, :290, :390`) | permanent-denial dead end (B7) |
| JobStatus | ✅ (`:64-69`) | ✅ "job not found" (`:138-140`) | ✅ + retry + per-stage errors | **best-in-app; use as the template** |
| Analysis | ✅ (`:277-283`) | ✅ "not found" | ⚠️ conflated with not-found, no retry (B15) | |
| History | ✅ | ⚠️ exists but invisible text (B1) | ❌ | |
| Compare | ✅ (list spinner `:140`) | ❌ blank (B17) | ❌ | "No comparable phases" ✅ |
| ProCompare | ✅ | ✅ | ❌ | |
| Login | ✅ (`:66-72`) | n/a | ✅ banner | session-fetch error silently renders sign-in form (acceptable) |
| Privacy | static | — | — | fine |

**No screen spins forever** — all spinners are tied to `isLoading`, and JobStatus's `refetchInterval` correctly stops on completed/failed. The failure mode is the opposite: errors masquerading as empty states.

## 4. Accessibility findings (consolidated)

- **Labels/roles:** 1 of ~30 touchables annotated (B4). No icon-only buttons exist (all have text children, so VoiceOver reads *something*), but role="button", selected states, the long-press delete (B5), and the court handles (B13) are real blockers.
- **Touch targets:** primary pills are ≥44pt (several even set `minHeight: 48` — good); offenders are the skip links, Compare toggles, and 28pt court handles (B13, B19).
- **Contrast on the new palette:** mostly strong — ink/ink2/accent/danger on paper are 5.9–13:1; sand-on-flood ≈4.9:1; white70-on-flood fine. Failures are confined to the light card-paper context: the invisible History empty state (B1) and badges on light rows (B10); `muted` is borderline (B22).
- **Motion:** no reduce-motion handling anywhere (B16); otherwise the app is admirably animation-light (progress = solid width bars, exactly per spec).
- **Dark mode / status bar:** app is intentionally dark-only with `StatusBar style="light"` (`App.tsx:57`) and a fully tokenized React Navigation theme (`App.tsx:38-49`) — consistent.

## 5. What the Court Flood overhaul got RIGHT

- **Real centralized tokens, actually used.** Every screen styles exclusively through `theme`/`radius`; only ~10 hardcoded color literals remain in 4,300 lines, mostly in the camera/overlay context. This comfortably beats the web app's state at the time of the ARCHITECTURE_REVIEW §3 review.
- **Clean retirement of Tennis Neon.** Zero `#0f172a`/`#a3e635`/slate remnants in code; only the stale CLAUDE.md sentence survives.
- **CTA voice is uniform and on-spec:** white pill primary (`cta`/`ctaInk`), translucent `white10`+`white15`-border secondary, sand reserved for pro/PB markers — exactly the design.md hierarchy, on every screen.
- **Radius language is consistent:** pills for buttons/chips, 16 for cards, 12 for inputs — via the `radius` tokens, never raw values.
- **Stat-led rhythm executed:** uppercase tracked micro-labels above `tabular-nums` hero numbers throughout; `fontVariant: ["tabular-nums"]` on every score/timer.
- **Flood-as-architecture understood:** Analysis's score hero (`AnalysisScreen.tsx:615-622`) is a textbook single flood surface with `white70` secondary ink; Home correctly carries *no* flood (allowed). Only History double-floods (B9).
- **Honest copy discipline holds:** no fabricated stats anywhere; em-dash placeholders in Compare slots; demo content explicitly labelled; History KPIs computed from the real list.
- **JobStatusScreen is a model screen:** loading/error/not-found/failed-with-retry all handled, per-stage ledger with solid width-animated bars (no shimmer — per the anti-pattern list), token-colored stage states.
- **Record hygiene:** unmount cleanup stops the camera session and clears the timer; upload failure returns you to preview with the clip intact rather than losing the take; History delete confirms destructively via Alert.
- **Navigation theming:** React Navigation `DarkTheme` extended with Court Flood tokens so headers, transitions, and system surfaces all match the paper — no white-flash mismatch.

---

# Recommended fix order

1. **A1 — `includeLandmarks: true`** (one-line fix; skeleton replay is broken in production for every real analysis)
2. **A2 — focus-effect refetch storm** (compounds A1: full landmark payload refetched ~2×/sec during replay)
3. **A3 — ball overlay pixel-space normalization** (second headline beta feature silently broken)
4. **B1 + B3 — invisible empty state + errors-as-empty on list screens**
5. **B2 / A14 — "Your sports schedule" copy leak**
6. **B4 + B5 — accessibility sweep + discoverable delete**
7. **B7 + B8 — Record permission dead end + mid-recording discard guard**
8. **A5, A6, A7 — AsyncStorage guard, cache invalidation + focusManager wiring, upload timeout/progress**
9. Remaining mediums/lows opportunistically.
