/**
 * Public types for the ads package.
 *
 * Aligned to the LIVE Google Publisher Tag reference + release notes
 * (verified June 2026). Key facts that shaped these types:
 *  - enableSingleRequest / enableLazyLoad / disableInitialLoad /
 *    collapseEmptyDivs were all deprecated the week of 2025-07-28 in favor of
 *    googletag.setConfig({ singleRequest, lazyLoad, disableInitialLoad,
 *    collapseDiv }). We use the setConfig forms.
 *  - collapseDiv accepts 'ON_NO_FILL' | 'BEFORE_FETCH' (string enum).
 *  - setPublisherProvidedId() and setPrivacySettings() are NOT deprecated.
 *  - PPS (Publisher Provided Signals) is configured via setConfig({ pps })
 *    and is DISTINCT from Secure Signals (ESP).
 *  - OutOfPageFormat includes TOP/BOTTOM_ANCHOR, LEFT/RIGHT_SIDE_RAIL,
 *    INTERSTITIAL, REWARDED, GAME_MANUAL_INTERSTITIAL.
 */

export type Sizing = [number, number] | 'fluid'

/** A 'size' for googletag — array of fixed [w,h] tuples, plus optional 'fluid'. */
export type SlotSize = Sizing[]

/** Per-breakpoint sizes: each entry maps a min-width (px) to its eligible sizes.
 *  Use `0` for "default / smallest screens" — matches GPT's sizeMapping semantics. */
export type SizeMap = Record<number, SlotSize>

/** Reserved height (px) per breakpoint min-width. Used to set min-height on the
 *  container so the slot reserves real space → ZERO CLS contribution. */
export type ReserveMap = Record<number, number>

/** Device class. Resolved server-side from Cloudflare's `CF-Device-Type` header
 *  (mobile|tablet|desktop); the same signal keys the CF cache, so render + cache
 *  always agree. A slot whose `devices` excludes the active class is never
 *  defined (no billable request, no CLS). */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop'

/** Ad serving mode (per environment):
 *  - 'live': your real GAM network — billable impressions (production).
 *  - 'test': serve from Google's sample network (/6355419/…) so positions,
 *    rules, device-gating, sizes, refresh, and targeting all render with TEST
 *    creatives — no real reporting/billing/IVT (staging validation; the
 *    documented "Display a test ad" mechanism).
 *  - 'off': no ads at all. */
export type AdsMode = 'live' | 'test' | 'off'

export type SlotProps = {
  /** Ad unit path WITHOUT the network prefix (e.g. "post/in-content").
   *  The package config prepends `/{networkCode}/`. */
  adUnit: string
  /** Sizes per breakpoint min-width. Required. */
  sizes: SizeMap
  /** Reserved heights per breakpoint min-width. Required for zero CLS. */
  reserve: ReserveMap
  /** DOM id override — usually let the component generate one. */
  id?: string
  /** Slot-level key-values (mapped to slot.setConfig({ targeting })). */
  targeting?: Record<string, string | string[]>
  /** Above the fold? RESERVED / currently a no-op in the inline path: with
   *  singleRequest + lazyLoad, above-fold slots already fetch in the first SRA
   *  batch and below-fold slots defer automatically, so no explicit ordering is
   *  applied here. Kept for forward-compat. Default: false. */
  abovefold?: boolean
  /** Enable viewable-gated refresh on this slot. Default: false.
   *  Refreshed impressions are tagged `refresh=1` for GAM reporting AND
   *  REQUIRE you to DECLARE the refresh inventory in GAM (otherwise it's a
   *  Google policy violation Google actively detects). */
  refresh?: boolean | RefreshConfig
  /** Device classes this slot serves on. Undefined = all. The server emits the
   *  slot only when the active class is included; the CF cache is keyed by the
   *  same `CF-Device-Type` signal so the cached variant matches. */
  devices?: DeviceClass[]
}

export type RefreshConfig = {
  /** Min interval seconds, default 60. Hard floor is 30s; framework clamps to 30. */
  intervalSec?: number
  /** Required viewable percentage, default 50. */
  minViewablePct?: number
  /** Max refreshes per slot per session, default 8. */
  cap?: number
}

export type AnchorProps = {
  adUnit: string
  /** TOP_ANCHOR or BOTTOM_ANCHOR. Default: BOTTOM_ANCHOR. */
  position?: 'top' | 'bottom'
  id?: string
  /** Device classes this anchor serves on. Undefined = all. */
  devices?: DeviceClass[]
}

/** Side-rail (desktop gutter) out-of-page format. LEFT/RIGHT_SIDE_RAIL were
 *  added to OutOfPageFormat the week of 2023-12-11. */
export type SideRailProps = {
  adUnit: string
  side: 'left' | 'right'
  id?: string
  /** Device classes — side rails are typically desktop-only. Undefined = all. */
  devices?: DeviceClass[]
}

export type InterstitialTriggers = {
  unhideWindow?: boolean
  navBar?: boolean
  inactivity?: boolean
  backward?: boolean
  endOfArticle?: boolean
}

export type InterstitialProps = {
  adUnit: string
  /** Triggers for showing the interstitial. Default: { unhideWindow:true, endOfArticle:true }. */
  triggers?: InterstitialTriggers
  id?: string
  /** Device classes this interstitial serves on. Undefined = all. */
  devices?: DeviceClass[]
}

/** collapseDiv mode — matches GPT's CollapseDivBehavior ("DISABLED" |
 *  "BEFORE_FETCH" | "ON_NO_FILL"), replacing deprecated collapseEmptyDivs:
 *  - 'DISABLED':    never collapse (default; pairs with reserved heights).
 *  - 'ON_NO_FILL':  expanded by default, collapses only on no-fill.
 *  - 'BEFORE_FETCH': collapsed by default, expands only if filled.
 *  NOTE: ON_NO_FILL / BEFORE_FETCH cause a shift vs a reserved placeholder. For
 *  ZERO CLS, leave this UNSET (or 'DISABLED') and rely on <AdSlot reserve={…}/>. */
export type CollapseDiv = 'DISABLED' | 'BEFORE_FETCH' | 'ON_NO_FILL'

/**
 * Publisher Provided Signals (PPS) — DISTINCT from Secure Signals (ESP).
 * Configured via setConfig({ pps: { taxonomies: {...} }}).
 *
 * This is a TYPED PASS-THROUGH: you supply the exact taxonomy keys and value
 * IDs that match your GAM PPS configuration. We do NOT hardcode taxonomy key
 * strings — pass what your GAM account documents, verbatim. Common keys:
 *   IAB_AUDIENCE_1_1, IAB_CONTENT_2_2
 * Each maps to { values: string[] } of taxonomy category IDs.
 */
export type PpsConfig = {
  taxonomies: Record<string, { values: string[] }>
}

/** Age treatment — matches GPT's enums.TagForAgeTreatment, set via
 *  setPrivacySettings({ tagForAgeTreatment }). Only set if your audience
 *  requires child/teen protections. */
export type TagForAgeTreatment = 'UNSPECIFIED' | 'CHILD' | 'TEEN'

/** Site-wide ads configuration consumed by AdScripts (head emitter). */
export type AdsSiteConfig = {
  /** Numeric GAM network code, e.g. "21842055933". */
  networkCode: string
  /** Network used in 'test' mode (staging). Defaults to Google's sample network
   *  "6355419". Set this to your own GAM test network/units if you have them. */
  testNetworkCode?: string
  /**
   * MCM manager pub-id you sell under, if you're an MCM child (e.g. "pub-3383802709640954").
   * Surfaced here primarily as documentation for ads.txt MANAGERDOMAIN coordination.
   */
  mcmManagerPubId?: string
  /** Domain of your MCM manager (Brius, etc.) — for ads.txt MANAGERDOMAIN. */
  mcmManagerDomain?: string
  /** SRA on by default. Pass false to disable. setConfig({singleRequest}). */
  singleRequest?: boolean
  /** Default lazy-load config. setConfig({lazyLoad}). */
  lazyLoad?: {
    fetchMarginPercent?: number
    renderMarginPercent?: number
    /** Multiplier applied to both margins on mobile devices. Recommended 1.5–2.0. */
    mobileScaling?: number
  }
  /** Collapse mode. UNSET by default (best for zero CLS with reserved heights).
   *  setConfig({collapseDiv}). */
  collapseDiv?: CollapseDiv
  /** Auto-mint and pass a stable PPID via setPublisherProvidedId. Default true. */
  enablePpid?: boolean
  /** Secure Signals (ESP) providers to register. */
  secureSignalProviders?: SecureSignalProvider[]
  /** Publisher Provided Signals (IAB taxonomies). Typed pass-through. */
  pps?: PpsConfig
  /** URL query-param names forwarded to GAM as PAGE-LEVEL key-values
   *  (pubads().setTargeting(key, urlValue)) at render time. Extracted from the DXP
   *  wrapper's customTargeting urlParam passthrough — e.g. utm_source / utm_medium /
   *  utm_campaign / utm_content / utm_term / utm_id for campaign attribution in GAM
   *  reporting. The KEY SET is per-site (static); the VALUES are read from the
   *  request URL at runtime. Empty/undefined = no page targeting. */
  urlTargetingKeys?: string[]
  /** Force npa=1 (non-personalized). Use only if your consent gates require. */
  forceNpa?: boolean
  /** Age treatment for child/teen audiences (optional). */
  tagForAgeTreatment?: TagForAgeTreatment
}

export type SecureSignalProvider = {
  /** Provider id (must match what the buyer expects). */
  id: string
  /** Function name available on window that returns the encrypted signal payload. */
  collectorFunction?: string
  /** Or pass a network id (Google-curated providers). */
  networkCode?: string
}

/* ──────────────── Ad-Inserter-style declarative placements ──────────────── */

/** Where an ad is inserted. In-content positions are injected by the Portable
 *  Text / rehype placement pass; the OOP positions map to GAM-managed formats. */
export type PlacementPosition =
  | 'before-content'
  | 'after-content'
  | 'before-paragraph'
  | 'after-paragraph'
  | 'anchor'
  | 'siderail-left'
  | 'siderail-right'
  | 'interstitial'

/** Conditions under which a placement applies (Ad-Inserter "insertion" filters).
 *  Evaluated server-side at render. */
export type PlacementWhere = {
  /** Only on posts in these content collections / types. */
  collections?: string[]
  /** Only on posts carrying any of these tags. */
  tags?: string[]
  /** Skip if the post has fewer than this many paragraphs. */
  minParagraphs?: number
  /** Skip if the post has fewer than this many words. */
  minWords?: number
}

/**
 * A declarative ad placement (the "Ad Inserter" rule). Authored per-site in
 * Payload (editor-managed) or in code. `sizes`/`reserve` are required
 * for in-content positions (before/after content/paragraph) and ignored for
 * the OOP positions (anchor/siderail/interstitial — GAM-managed).
 */
export type PlacementRule = {
  id: string
  position: PlacementPosition
  /** Paragraph index for *-paragraph positions. 1-based. Negative counts from
   *  the bottom (-1 = last). An array inserts at each index. */
  index?: number | number[]
  /** Recurring: insert every Nth paragraph (mutually exclusive-ish with index). */
  every?: number
  /** Device classes this placement serves on. Undefined = all. */
  devices?: DeviceClass[]
  /** Master on/off. */
  enabled: boolean
  /** Ad unit path (without the network prefix). */
  adUnit: string
  /** Required for in-content positions (zero-CLS); ignored for OOP. */
  sizes?: SizeMap
  /** Required for in-content positions (zero-CLS); ignored for OOP. */
  reserve?: ReserveMap
  /** Viewable refresh for this placement. */
  refresh?: boolean | RefreshConfig
  /** Insertion conditions. */
  where?: PlacementWhere
  /** Cap how many of THIS rule may insert into one post. */
  maxPerPost?: number
}
