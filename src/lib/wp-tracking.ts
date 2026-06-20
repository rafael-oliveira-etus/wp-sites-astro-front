/**
 * Headless port of BOLT's tracking injection (theme `tracking-pixels.php` +
 * `src/js/tracking-pixels-high-priority.js` + `tracking-pixels.js`, with the
 * lazy trigger from `bolt-core.js`). Behavior is IDENTICAL to the WP theme:
 *
 *  HEAD (eager):
 *   1. gtag/dataLayer bootstrap (always).
 *   2. window.boltTrackingConfig = {...ids} (always).
 *   3. if gaId → load gtag.js + run the high-priority GA4 config (client_id/
 *      session_id from ets_cid/ets_sid query params).
 *   4. initGTM trigger: after 10s, if !window.initGTMControl, push {event:'initGTM'}.
 *  FOOTER (lazy — first scroll, or a gesture after 7s, then +500ms):
 *   5. tracking-pixels.js body: Facebook + TikTok SDKs (init on the initGTM
 *      event, per-vertical cc/emp), and CTA click tracking on `.track` elements.
 *
 * Unlike the theme, our glue is INLINED (no request to a served JS file) — only
 * the third-party SDKs (gtag.js / fbevents.js / TikTok events.js) are fetched,
 * exactly as the theme fetches them. Each tracker's SDK loads only when its ID
 * exists (GA gated here; FB/TikTok gated inside the ported body). All inline
 * scripts must carry the per-request CSP nonce (strict-dynamic).
 */
import type { BoltTracking } from './wp-config';

/** True when at least one media/analytics ID is set — mirrors BOLT's footer
 *  guard (`gaId || facebookIdCC || facebookIdEMP || tiktokIdCC || tiktokIdEMP`). */
export function hasTracking(tk: BoltTracking | undefined): tk is BoltTracking {
  return !!tk && !!(tk.gaId || tk.facebookIdCC || tk.facebookIdEMP || tk.tiktokIdCC || tk.tiktokIdEMP);
}

/** window.boltTrackingConfig — the exact shape the ported JS reads. */
export function trackingConfigJs(tk: BoltTracking): string {
  const config = {
    gaId: tk.gaId,
    facebookIdCC: tk.facebookIdCC,
    facebookIdEMP: tk.facebookIdEMP,
    tiktokIdCC: tk.tiktokIdCC,
    tiktokIdEMP: tk.tiktokIdEMP,
  };
  return `window.boltTrackingConfig = ${JSON.stringify(config)};`;
}

/** wp_head prio 1 — always define gtag/dataLayer. (bolt_init_gtag_always) */
export const GTAG_INIT_JS =
  `(function(){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag._initialized=true;gtag('js',new Date())})();`;

/** wp_head prio 10 — kick initGTM after 10s unless a consent/GTM layer beat us. */
export const INITGTM_TRIGGER_JS =
  `setTimeout(function(){if(!window.initGTMControl&&window.dataLayer&&typeof window.dataLayer.push==='function'){window.dataLayer.push({'event':'initGTM'})}},10000);`;

/** tracking-pixels-high-priority.js — verbatim (GA4 config as early as possible). */
export const HIGH_PRIORITY_JS =
  `(function(){var config=window.boltTrackingConfig||{};if(!config.gaId)return;var params=new URLSearchParams(window.location.search);var pg_t=window.pageType?window.pageType.toLowerCase():'';var pg_v=window.pageVertical||'';var configParams={};if(pg_t)configParams.page_type=pg_t;if(pg_v)configParams.page_vertical=pg_v;var urlClientId=params.get('ets_cid');var urlSessionId=params.get('ets_sid');if(urlClientId){configParams.client_id=urlClientId}if(urlSessionId){configParams.session_id=urlSessionId}gtag('config',config.gaId,configParams)})();`;

/** gtag.js loader src for a GA id. */
export function gtagSrc(gaId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
}

// tracking-pixels.js — ported VERBATIM from BOLT `src/js/tracking-pixels.js`.
// Only change: wrapped so the bolt-lazy loader runs it once, inline, on the same
// trigger the theme uses (no external fetch of our glue).
const TRACKING_PIXELS_BODY = String.raw`(function() {
	var config = window.boltTrackingConfig || {};
	window.boltGetVertical = function() {
		if (window.pageVertical) return window.pageVertical;
		var verticalElement = document.getElementById('vertical');
		if (verticalElement) return verticalElement.value;
		var pathname = window.location.pathname;
		var verticalPatterns = {
			cc: /-cc-|-cartao-|-cartoes-|-tarjeta-|-card-|-credito-/,
			emp: /-emp-|-emprestimo-|-prestamo-|-loan-/
		};
		for (var key in verticalPatterns) {
			if (verticalPatterns[key].test(pathname)) return key;
		}
		var pageCats = document.querySelectorAll('meta[property="article:cat"]');
		for (var i = 0; i < pageCats.length; i++) {
			var value = pageCats[i].content;
			if (!value) continue;
			if (value.includes('conta')) return 'cd';
			else if (value == 'emp' || value.includes('emprestimo') || value.includes('prestamo')) return 'emp';
			else if (value == 'cc' || value.includes('cartao') || value.includes('tarjeta') || value.includes('credit-card')) return 'cc';
		}
		return null;
	};
	function onDataLayerEvent(eventName, callback) {
		window.dataLayer = window.dataLayer || [];
		if (Array.isArray(window.dataLayer)) {
			window.dataLayer.forEach(function(item) {
				if (item.event === eventName) { callback(item); }
			});
		}
		var originalPush = window.dataLayer.push;
		window.dataLayer.push = function() {
			var args = Array.prototype.slice.call(arguments);
			args.forEach(function(item) {
				if (item && item.event === eventName) { callback(item); }
			});
			return originalPush.apply(window.dataLayer, args);
		};
	}
	function getCookieValue(name) {
		var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
		return match ? decodeURIComponent(match[1]) : null;
	}
	function initFacebookSdk() {
		if (!config.facebookIdCC && !config.facebookIdEMP) return;
		!function(f,b,e,v,n,t,s)
		{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
		n.callMethod.apply(n,arguments):n.queue.push(arguments)};
		if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
		n.queue=[];t=b.createElement(e);t.async=!0;
		t.src=v;s=b.getElementsByTagName(e)[0];
		s.parentNode.insertBefore(t,s)}(window, document,'script',
		'https://connect.facebook.net/en_US/fbevents.js');
		initFacebookPixel();
		if (window.pageVertical === undefined) {
			setTimeout(function() {
				if (window.pageVertical !== undefined && window.pageVertical !== 'cc') { initFacebookPixel(); }
			}, 100);
			var checkPageVerticalFacebook = setInterval(function() {
				if (window.pageVertical !== undefined && window.pageVertical !== 'cc') {
					clearInterval(checkPageVerticalFacebook);
					initFacebookPixel();
				}
			}, 50);
			setTimeout(function() { clearInterval(checkPageVerticalFacebook); }, 5000);
		}
	}
	function initFacebookPixel() {
		var pageVertical = window.pageVertical || 'cc';
		var facebookId = config.facebookIdCC;
		if (pageVertical === 'cc' && config.facebookIdCC) {
			facebookId = config.facebookIdCC;
		} else if (pageVertical === 'emp' && config.facebookIdEMP) {
			facebookId = config.facebookIdEMP;
		}
		if (facebookId && typeof fbq !== 'undefined') {
			fbq('init', facebookId);
			fbq('track', 'PageView');
			fbq('track', 'ViewContent', {
				'content_id': window.pageVertical === 'emp' ? '2' : '1',
				'content_name': document.location.hostname + document.location.pathname,
				'content_type': 'product',
				'content_category': window.pageType ? window.pageType.toLowerCase() : undefined
			});
		}
	}
	function initTiktokSdk() {
		if (!config.tiktokIdCC && !config.tiktokIdEMP) return;
		!function (w, d, t) {
		w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
		}(window, document, 'ttq');
		initTiktokPixel();
		if (window.pageVertical === undefined) {
			setTimeout(function() {
				if (window.pageVertical !== undefined && window.pageVertical !== 'cc') { initTiktokPixel(); }
			}, 100);
			var checkPageVertical = setInterval(function() {
				if (window.pageVertical !== undefined && window.pageVertical !== 'cc') {
					clearInterval(checkPageVertical);
					initTiktokPixel();
				}
			}, 50);
			setTimeout(function() { clearInterval(checkPageVertical); }, 5000);
		}
	}
	function initTiktokPixel() {
		var pageVertical = window.pageVertical || 'cc';
		var tiktokId = null;
		if (pageVertical === 'cc' && config.tiktokIdCC) {
			tiktokId = config.tiktokIdCC;
		} else if (pageVertical === 'emp' && config.tiktokIdEMP) {
			tiktokId = config.tiktokIdEMP;
		}
		if (tiktokId && typeof ttq !== 'undefined') {
			ttq.load(tiktokId);
			ttq.page();
		}
	}
	onDataLayerEvent('initGTM', function() {
		initFacebookSdk();
		initTiktokSdk();
	});
	window.pageVertical = window.boltGetVertical();
	function initCtaTracking() {
		var btn_track = document.getElementsByClassName('track');
		var pg_t = window.pageType ? window.pageType.toLowerCase() : '';
		var ev_n = 'cta_click';
		if (pg_t) { ev_n = ev_n + '_' + pg_t; }
		if (btn_track) {
			btn_track = Array.from(btn_track);
			btn_track.forEach(function(element) {
				element.addEventListener('mousedown', function() {
					if (typeof gtag !== 'undefined' && !!gtag) {
						gtag('event', ev_n, {
							'page_template': pg_t,
							'vertical': window.pageVertical,
							'category': 'cta_click',
							'action': pg_t,
							'label': window.pageVertical,
							'value': 0,
							'non_interaction': false
						});
					}
					if (typeof fbq !== 'undefined' && !!fbq) {
						fbq('trackCustom', 'P1CTAClick');
					}
					try {
						if (typeof ttq !== 'undefined' && !!ttq) {
							ttq.identify({ 'email': getCookieValue('_quiz_maker_recomendation_email') });
							var content_id = '1';
							if (window.pageVertical === 'emp') { content_id = '2'; }
							ttq.track('ClickButton', {
								'content_id': content_id,
								'content_type': 'product',
								'content_category': window.pageVertical,
								'content_name': document.title
							});
						}
					} catch(err) { console.log('tiktok pixel error'); }
				});
			});
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initCtaTracking);
	} else {
		initCtaTracking();
	}
})();`;

/**
 * Footer inline script: bolt-core's lazy trigger (first scroll, or a gesture
 * after 7s, then +500ms) running the tracking-pixels body once, inline. Keeps the
 * theme's deferral so the media SDKs don't compete with first paint.
 */
export const TRACKING_LAZY_JS = `(function(){var ran=false;function run(){if(ran)return;ran=true;${TRACKING_PIXELS_BODY}}var scheduled=false;function scheduleOnce(){if(scheduled)return;scheduled=true;window.removeEventListener('scroll',scheduleOnce);window.removeEventListener('click',scheduleOnce);window.removeEventListener('touchstart',scheduleOnce);window.removeEventListener('keydown',scheduleOnce);setTimeout(run,500)}function addGestureFallbacksAfter7s(){if(scheduled)return;window.addEventListener('click',scheduleOnce,{passive:true,once:true});window.addEventListener('touchstart',scheduleOnce,{passive:true,once:true});window.addEventListener('keydown',scheduleOnce,{passive:true,once:true})}function init(){window.addEventListener('scroll',scheduleOnce,{passive:true,once:true});setTimeout(addGestureFallbacksAfter7s,7000)}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init,{once:true})}else{init()}})();`;
