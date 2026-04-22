import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

from playwright.async_api import BrowserContext, Locator, Page, async_playwright

from app.config import settings

# Pull credentials strictly from the settings
BASE_URL = settings.CLIENT_URL.rstrip("/")
ADMIN_EMAIL = settings.SUPERADMIN_EMAIL
ADMIN_PASSWORD = settings.SUPERADMIN_PASSWORD
STAGE0_ARTIFACT_ROOT = Path(__file__).resolve().parents[2] / "stage0_artifacts"

if not all([BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD]):
    raise ValueError(
        "CLIENT_URL, SUPERADMIN_EMAIL, and SUPERADMIN_PASSWORD must be strictly defined in the .env file."
    )


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "artifact"


def _proposal_artifact_dir(proposal_id: str) -> Path:
    proposal_dir = STAGE0_ARTIFACT_ROOT / proposal_id
    proposal_dir.mkdir(parents=True, exist_ok=True)
    return proposal_dir


def _looks_like_image(value: str) -> bool:
    lowered = value.lower()
    return lowered.startswith(("http://", "https://", "/")) and (
        any(ext in lowered for ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"))
        or "image" in lowered
        or "thumbnail" in lowered
        or "icon" in lowered
    )


def _coerce_url(candidate: str) -> str:
    if candidate.startswith(("http://", "https://")):
        return candidate
    return urljoin(f"{BASE_URL}/", candidate.lstrip("/"))


def _find_thumbnail_url(payload: Any) -> Optional[str]:
    preferred_keys = {
        "thumbnail",
        "thumbnailurl",
        "thumbnail_url",
        "icon",
        "iconurl",
        "icon_url",
        "coverimage",
        "cover_image",
        "poster",
        "posterurl",
        "poster_url",
        "featuredimage",
        "featured_image",
        "image",
        "imageurl",
        "image_url",
        "heroimage",
        "hero_image",
    }

    def walk(node: Any, parent_key: str = "") -> Optional[str]:
        if isinstance(node, str):
            if parent_key in preferred_keys and _looks_like_image(node):
                return _coerce_url(node)
            return None

        if isinstance(node, dict):
            for key, value in node.items():
                normalized = re.sub(r"[^a-z0-9]", "", key.lower())
                if isinstance(value, str) and normalized in preferred_keys and _looks_like_image(value):
                    return _coerce_url(value)
                if isinstance(value, dict):
                    nested_url = value.get("url") or value.get("src") or value.get("path")
                    if normalized in preferred_keys and isinstance(nested_url, str) and _looks_like_image(nested_url):
                        return _coerce_url(nested_url)
                found = walk(value, normalized)
                if found:
                    return found

        if isinstance(node, list):
            for item in node:
                found = walk(item, parent_key)
                if found:
                    return found

        return None

    return walk(payload)


async def _dismiss_overlays(page: Page) -> None:
    selectors = [
        "button:has-text('Accept')",
        "button:has-text('I Agree')",
        "button:has-text('Agree')",
        "button:has-text('OK')",
        "button:has-text('Got it')",
        "button:has-text('Continue')",
        "button:has-text('Play')",
        "[id*='cookie'] button",
        "[class*='cookie'] button",
        "[aria-label*='accept' i]",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.is_visible():
                await locator.click(timeout=1500)
                await page.wait_for_timeout(800)
        except Exception:
            continue


async def _dismiss_ads_and_popups(page: Page) -> None:
    close_selectors = [
        "button[aria-label*='close' i]",
        "button[title*='close' i]",
        "[role='button'][aria-label*='close' i]",
        ".modal-close",
        ".popup-close",
        ".close-btn",
        ".close-button",
        ".ad_close",
        ".ad-close",
        ".ads-close",
        ".dismiss",
        ".btn-close",
        "[class*='close']",
        "[id*='close']",
    ]

    for selector in close_selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
        except Exception:
            continue

        for index in range(min(count, 8)):
            candidate = locator.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                box = await candidate.bounding_box()
                if box and box["width"] > 140 and box["height"] > 80:
                    continue
                await candidate.click(timeout=1200)
                await page.wait_for_timeout(300)
            except Exception:
                continue

    try:
        await page.evaluate(
            """
            () => {
              const keywords = ["ad", "ads", "advert", "banner", "popup", "modal", "overlay", "interstitial"];
              const nodes = Array.from(document.querySelectorAll("body *"));
              for (const node of nodes) {
                const id = (node.id || "").toLowerCase();
                const className = typeof node.className === "string" ? node.className.toLowerCase() : "";
                const role = (node.getAttribute("role") || "").toLowerCase();
                const matchesKeyword = keywords.some((keyword) => id.includes(keyword) || className.includes(keyword));
                const rect = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                const isLargeFixedOverlay =
                  (style.position === "fixed" || style.position === "sticky") &&
                  rect.width >= window.innerWidth * 0.2 &&
                  rect.height >= window.innerHeight * 0.15 &&
                  parseInt(style.zIndex || "0", 10) >= 10;
                const likelyDialog = role === "dialog" || role === "alertdialog";
                if (matchesKeyword || isLargeFixedOverlay || likelyDialog) {
                  node.remove();
                }
              }
            }
            """
        )
    except Exception:
        pass


async def _close_secondary_pages(context: BrowserContext, primary_page: Page) -> None:
    for candidate in context.pages:
        if candidate == primary_page:
            continue
        try:
            await candidate.close()
        except Exception:
            continue


async def _click_start_controls(page: Page) -> None:
    selectors = [
        "button:has-text('Play')",
        "button:has-text('Start')",
        "button:has-text('Continue')",
        "[aria-label*='play' i]",
        "[class*='play']",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.is_visible():
                await locator.click(timeout=1500)
                await page.wait_for_timeout(1500)
                return
        except Exception:
            continue


async def _largest_visible_locator(page: Page, selectors: List[str]) -> Optional[Locator]:
    best_locator: Optional[Locator] = None
    best_area = 0.0

    for selector in selectors:
        locator = page.locator(selector)
        try:
            count = await locator.count()
        except Exception:
            continue

        for index in range(min(count, 10)):
            candidate = locator.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                await candidate.scroll_into_view_if_needed(timeout=1500)
                box = await candidate.bounding_box()
                if not box:
                    continue
                area = box["width"] * box["height"]
                if box["width"] < 240 or box["height"] < 180 or area <= best_area:
                    continue
                best_area = area
                best_locator = candidate
            except Exception:
                continue

    return best_locator


async def _locate_game_surface(page: Page) -> tuple[Optional[Locator], str]:
    selectors = [
        "[data-testid*='game'] iframe",
        "[data-testid*='game'] canvas",
        "[class*='game'] iframe",
        "[class*='game'] canvas",
        "[id*='game'] iframe",
        "[id*='game'] canvas",
        "main iframe",
        "main canvas",
        "iframe",
        "canvas",
        "embed",
        "object",
    ]
    locator = await _largest_visible_locator(page, selectors)
    if not locator:
        return None, "missing"

    try:
        return locator, await locator.evaluate("node => node.tagName.toLowerCase()")
    except Exception:
        return locator, "unknown"


async def _extract_page_metadata(page: Page, requested_url: str) -> Dict[str, Any]:
    metadata = await page.evaluate(
        """
        (requestedUrl) => {
          const normalizeWhitespace = (value) => (value || "").replace(/\\s+/g, " ").trim();
          const truncate = (value, limit = 4000) => {
            const normalized = normalizeWhitespace(value);
            if (normalized.length <= limit) {
              return normalized;
            }
            return normalized.slice(0, limit) + "...";
          };
          const unique = (values) => Array.from(new Set((values || []).map(normalizeWhitespace).filter(Boolean)));
          const getAttribute = (selectors, attr = "content") => {
            for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
              const node = document.querySelector(selector);
              const value = node?.getAttribute(attr);
              if (value) {
                return normalizeWhitespace(value);
              }
            }
            return "";
          };
          const getText = (node) => truncate(node?.innerText || node?.textContent || "", 6000);
          const getTextList = (selector, minLength = 0, limit = 50) =>
            unique(
              Array.from(document.querySelectorAll(selector))
                .map((node) => normalizeWhitespace(node.innerText || node.textContent || ""))
                .filter((text) => text.length >= minLength)
            ).slice(0, limit);
          const extractNames = (value) => {
            if (!value) return [];
            if (Array.isArray(value)) return unique(value.flatMap(extractNames));
            if (typeof value === "string") return [normalizeWhitespace(value)];
            if (typeof value === "object") {
              return unique([
                value.name,
                value.legalName,
                value.alternateName,
                value.brand?.name,
              ].flatMap(extractNames));
            }
            return [];
          };
          const flattenSchemaItems = (input) => {
            if (!input) return [];
            if (Array.isArray(input)) return input.flatMap(flattenSchemaItems);
            if (typeof input !== "object") return [];
            if (Array.isArray(input["@graph"])) return input["@graph"].flatMap(flattenSchemaItems);
            return [input];
          };
          const safeJsonParse = (value) => {
            try {
              return JSON.parse(value);
            } catch (_error) {
              return null;
            }
          };
          const ldJsonItems = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map((node) => safeJsonParse(node.textContent || ""))
            .filter(Boolean)
            .flatMap(flattenSchemaItems);
          const relevantStructuredData = ldJsonItems
            .filter((item) => typeof item === "object")
            .map((item) => {
              const typeValue = Array.isArray(item["@type"]) ? item["@type"].join(", ") : item["@type"] || "";
              return {
                type: normalizeWhitespace(typeValue),
                name: normalizeWhitespace(item.name || ""),
                headline: normalizeWhitespace(item.headline || ""),
                description: truncate(item.description || "", 3000),
                genre: Array.isArray(item.genre) ? unique(item.genre) : unique([item.genre]),
                category: Array.isArray(item.applicationCategory)
                  ? unique(item.applicationCategory)
                  : unique([item.applicationCategory || item.category]),
                operating_system: normalizeWhitespace(item.operatingSystem || ""),
                url: normalizeWhitespace(item.url || ""),
                image: Array.isArray(item.image) ? normalizeWhitespace(item.image[0] || "") : normalizeWhitespace(item.image || ""),
                author: extractNames(item.author),
                creator: extractNames(item.creator),
                publisher: extractNames(item.publisher),
                aggregate_rating: item.aggregateRating
                  ? {
                      rating_value: normalizeWhitespace(String(item.aggregateRating.ratingValue || "")),
                      rating_count: normalizeWhitespace(String(item.aggregateRating.ratingCount || "")),
                      review_count: normalizeWhitespace(String(item.aggregateRating.reviewCount || "")),
                    }
                  : null,
              };
            })
            .slice(0, 20);
          const faqFromSchema = ldJsonItems
            .filter((item) => {
              const typeValue = Array.isArray(item["@type"]) ? item["@type"].join(" ") : item["@type"] || "";
              return /faqpage/i.test(typeValue);
            })
            .flatMap((item) => Array.isArray(item.mainEntity) ? item.mainEntity : [])
            .map((entry) => ({
              question: normalizeWhitespace(entry?.name || ""),
              answer: truncate(
                typeof entry?.acceptedAnswer === "string"
                  ? entry.acceptedAnswer
                  : entry?.acceptedAnswer?.text || entry?.acceptedAnswer?.name || "",
                3000
              ),
            }))
            .filter((entry) => entry.question && entry.answer);
          const faqFromDom = Array.from(document.querySelectorAll("details"))
            .map((node) => {
              const question = normalizeWhitespace(node.querySelector("summary")?.innerText || "");
              const cloned = node.cloneNode(true);
              const summary = cloned.querySelector("summary");
              if (summary) summary.remove();
              const answer = truncate(cloned.innerText || cloned.textContent || "", 3000);
              return { question, answer };
            })
            .filter((entry) => entry.question && entry.answer);
          const breadcrumb = getTextList(
            'nav[aria-label*="breadcrumb" i] a, nav[aria-label*="breadcrumb" i] li, .breadcrumb a, .breadcrumb li, [class*="breadcrumb"] a, [class*="breadcrumb"] li',
            1,
            20
          );
          const categories = unique([
            ...breadcrumb,
            ...getTextList('a[rel="category"], a[href*="/category/"], [class*="category"] a', 2, 20),
            ...getTextList('meta[property="article:section"]', 1, 10),
          ]);
          const tags = unique([
            ...getTextList('a[rel="tag"], a[href*="/tag/"], [class*="tag"] a, .tags a', 2, 30),
            ...getAttribute('meta[name="keywords"]').split(","),
          ]);
          const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
            .map((node) => ({
              level: node.tagName.toLowerCase(),
              text: normalizeWhitespace(node.innerText || node.textContent || ""),
            }))
            .filter((entry) => entry.text)
            .slice(0, 60);
          const sectionBlocks = unique(
            Array.from(document.querySelectorAll("h1, h2, h3, h4"))
              .map((headingNode) => {
                const heading = normalizeWhitespace(headingNode.innerText || headingNode.textContent || "");
                if (!heading) return null;
                const container = headingNode.closest("section, article, main, div") || headingNode.parentElement || headingNode;
                const listItems = unique(
                  Array.from(container.querySelectorAll("li"))
                    .map((item) => normalizeWhitespace(item.innerText || item.textContent || ""))
                    .filter((text) => text.length >= 3)
                ).slice(0, 20);
                const links = unique(
                  Array.from(container.querySelectorAll("a[href]"))
                    .map((link) => normalizeWhitespace(link.innerText || link.textContent || ""))
                    .filter((text) => text.length >= 3)
                ).slice(0, 20);
                return JSON.stringify({
                  heading,
                  level: headingNode.tagName.toLowerCase(),
                  text: truncate(container.innerText || container.textContent || "", 3500),
                  list_items: listItems,
                  links,
                });
              })
              .filter(Boolean)
          ).map((raw) => JSON.parse(raw)).slice(0, 30);
          const findSectionText = (...patterns) => {
            for (const section of sectionBlocks) {
              const label = normalizeWhitespace(section.heading || "").toLowerCase();
              if (patterns.some((pattern) => label.includes(pattern))) {
                return section;
              }
            }
            return null;
          };
          const mainContainer = document.querySelector("main, article, [role='main']") || document.body;
          const contentBlocks = unique(
            Array.from(mainContainer.querySelectorAll("p, li"))
              .map((node) => normalizeWhitespace(node.innerText || node.textContent || ""))
              .filter((text) => text.length >= 25)
          ).slice(0, 120);
          const mainText = truncate(mainContainer.innerText || mainContainer.textContent || "", 20000);
          const developerMentions = unique([
            ...relevantStructuredData.flatMap((item) => [...(item.author || []), ...(item.creator || []), ...(item.publisher || [])]),
            ...Array.from(
              (mainText || "").matchAll(
                /(developed by|developer|published by|publisher|creator|created by|studio)\\s*:?\\s*([A-Z0-9][A-Za-z0-9&.,'()\\-\\s]{2,80})/gi
              )
            ).map((match) => normalizeWhitespace(match[2] || "")),
          ]).slice(0, 20);
          const ratings = {
            rating_value: getAttribute(
              ['meta[itemprop="ratingValue"]', '[itemprop="ratingValue"]', 'meta[property="og:rating"]'],
              "content"
            ) || normalizeWhitespace(document.querySelector('[itemprop="ratingValue"]')?.textContent || ""),
            rating_count: getAttribute(
              ['meta[itemprop="ratingCount"]', '[itemprop="ratingCount"]'],
              "content"
            ) || normalizeWhitespace(document.querySelector('[itemprop="ratingCount"]')?.textContent || ""),
            review_count: getAttribute(
              ['meta[itemprop="reviewCount"]', '[itemprop="reviewCount"]'],
              "content"
            ) || normalizeWhitespace(document.querySelector('[itemprop="reviewCount"]')?.textContent || ""),
            votes_text: getTextList('[class*="rating"], [class*="vote"], [id*="rating"], [id*="vote"]', 3, 10),
          };
          const keySections = {
            about: findSectionText("about", "description", "overview"),
            how_to_play: findSectionText("how to play", "game instructions", "instructions"),
            controls: findSectionText("controls", "keyboard", "mouse", "touch"),
            faq: findSectionText("faq", "frequently asked questions"),
            developer: findSectionText("developer", "developed by", "publisher", "creator", "studio"),
            features: findSectionText("features", "gameplay", "modes"),
          };
          return {
            requested_url: requestedUrl,
            final_url: window.location.href,
            title: document.title || "",
            meta_description: getAttribute(['meta[name="description"]']),
            meta_keywords: getAttribute(['meta[name="keywords"]']),
            og_title: getAttribute(['meta[property="og:title"]']),
            og_description: getAttribute(['meta[property="og:description"]']),
            og_image: getAttribute(['meta[property="og:image"]']),
            og_type: getAttribute(['meta[property="og:type"]']),
            og_site_name: getAttribute(['meta[property="og:site_name"]']),
            twitter_title: getAttribute(['meta[name="twitter:title"]']),
            twitter_description: getAttribute(['meta[name="twitter:description"]']),
            twitter_image: getAttribute(['meta[name="twitter:image"]']),
            canonical_url: getAttribute(['link[rel="canonical"]'], "href"),
            headings,
            breadcrumb,
            categories,
            tags,
            ratings,
            structured_data: relevantStructuredData,
            faq_items: unique(
              [...faqFromSchema, ...faqFromDom].map((entry) => JSON.stringify(entry))
            ).map((raw) => JSON.parse(raw)).slice(0, 30),
            section_blocks: sectionBlocks,
            key_sections: keySections,
            developer_mentions: developerMentions,
            content_blocks: contentBlocks,
            main_text_excerpt: mainText,
            visible_text_length: normalizeWhitespace(mainContainer.innerText || mainContainer.textContent || "").length,
          };
        }
        """,
        requested_url,
    )
    return metadata


async def _capture_thumbnail_image(page: Page, thumbnail_url: str, output_path: Path) -> Dict[str, Any]:
    await page.set_viewport_size({"width": 1280, "height": 800})
    await page.set_content(
        f"""
        <html>
          <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#10131a;height:100vh;">
            <img id="game-thumbnail" src="{thumbnail_url}" style="max-width:90vw;max-height:90vh;object-fit:contain;" />
          </body>
        </html>
        """,
        wait_until="networkidle",
    )
    image = page.locator("#game-thumbnail")
    await image.wait_for(state="visible", timeout=15000)
    await page.wait_for_function(
        "() => document.getElementById('game-thumbnail')?.complete === true",
        timeout=15000,
    )
    await image.screenshot(path=str(output_path))
    return {
        "source_url": thumbnail_url,
        "capture_type": "thumbnail",
        "screenshot_path": str(output_path),
    }


async def capture_game_preview(
    proposal_id: str,
    proposal_snapshot: Optional[Dict[str, Any]] = None,
    game_title: str = "",
) -> Dict[str, Any]:
    """
    Stage 0 internal capture:
    1. Capture the proposal thumbnail/icon.
    2. Five seconds later, capture the ArcadeBox gameplay render/start state.
    """
    artifact_dir = _proposal_artifact_dir(proposal_id) / "internal"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    thumbnail_path = artifact_dir / "reference_thumbnail.png"
    gameplay_path = artifact_dir / "reference_gameplay_start.png"
    metadata_path = artifact_dir / "internal_capture_metadata.json"

    thumbnail_url = _find_thumbnail_url(proposal_snapshot or {})
    if not thumbnail_url:
        raise ValueError("Stage 0 requires a resolvable internal thumbnail/icon reference.")
    preview_url = f"{BASE_URL}/gameplay/{proposal_id}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            thumbnail_meta = await _capture_thumbnail_image(page, thumbnail_url, thumbnail_path)

            thumbnail_captured_at = time.monotonic()

            await page.goto(preview_url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(5000)
            await _dismiss_overlays(page)
            await _click_start_controls(page)
            game_surface, surface_type = await _locate_game_surface(page)
            if not game_surface:
                raise ValueError("Failed to locate internal gameplay render.")

            elapsed_since_thumbnail = time.monotonic() - thumbnail_captured_at
            remaining_delay = max(0.0, 5.0 - elapsed_since_thumbnail)
            if remaining_delay:
                await page.wait_for_timeout(int(remaining_delay * 1000))
            await game_surface.screenshot(path=str(gameplay_path))

            gameplay_meta = {
                "source_url": preview_url,
                "capture_type": "gameplay_start",
                "surface_type": surface_type,
                "screenshot_path": str(gameplay_path),
            }

            combined_metadata = {
                "proposal_id": proposal_id,
                "game_title": game_title,
                "thumbnail": thumbnail_meta,
                "gameplay_start": gameplay_meta,
            }
            metadata_path.write_text(json.dumps(combined_metadata, indent=2), encoding="utf-8")

            return {
                "artifact_dir": str(artifact_dir),
                "paths": [str(thumbnail_path), str(gameplay_path)],
                "metadata": combined_metadata,
            }

        except Exception as exc:
            error_screenshot = artifact_dir / "internal_capture_error.png"
            await page.screenshot(path=str(error_screenshot))
            raise ValueError(
                f"Internal Stage 0 capture failed: {exc}. Debug screenshot: {error_screenshot}"
            ) from exc
        finally:
            await browser.close()


async def capture_external_page(url: str, output_path: str) -> Optional[Dict[str, Any]]:
    """
    Stage 0 external capture:
    Browse to a search result, wait for the playable game surface, then capture
    both the rendered game area and the page metadata used for ranking.
    """
    screenshot_path = Path(output_path)
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = screenshot_path.with_suffix(".json")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(4000)
            await _dismiss_overlays(page)
            await _dismiss_ads_and_popups(page)
            await _click_start_controls(page)

            # Allow enough time for the embedded playable surface to render.
            await page.wait_for_timeout(12000)
            await _close_secondary_pages(context, page)
            await page.bring_to_front()
            await _dismiss_overlays(page)
            await _dismiss_ads_and_popups(page)
            game_surface, surface_type = await _locate_game_surface(page)
            if not game_surface:
                return None

            await game_surface.screenshot(path=str(screenshot_path))
            metadata = await _extract_page_metadata(page, url)
            metadata.update(
                {
                    "surface_type": surface_type,
                    "screenshot_path": str(screenshot_path),
                }
            )
            metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

            return {
                "url": url,
                "screenshot_path": str(screenshot_path),
                "metadata_path": str(metadata_path),
                "metadata": metadata,
            }

        except Exception:
            return None
        finally:
            await browser.close()


async def search_for_urls(search_query: str, output_dir: str, count: int = 5) -> Dict[str, Any]:
    """
    Stage 0 search layer:
    Executes a browser-based web search with Playwright and captures the search
    results page for downstream vision-assisted selection.
    """
    artifact_dir = Path(output_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    search_targets = [
        {
            "name": "google",
            "url": f"https://www.google.com/search?q={quote_plus(search_query)}",
            "selectors": ["div.yuRUbf a", "a h3", "main a[href]"],
            "href_filters": ("google.com",),
        },
        {
            "name": "brave",
            "url": f"https://search.brave.com/search?q={quote_plus(search_query)}",
            "selectors": ["a[data-test-id='result-title-a']", "main a[href]"],
            "href_filters": ("search.brave.com", "brave.com"),
        },
        {
            "name": "bing",
            "url": f"https://www.bing.com/search?q={quote_plus(search_query)}",
            "selectors": ["li.b_algo h2 a", "main a[href]"],
            "href_filters": ("bing.com", "microsoft.com"),
        },
        {
            "name": "duckduckgo",
            "url": f"https://duckduckgo.com/?q={quote_plus(search_query)}&ia=web",
            "selectors": [".result__a", "[data-testid='result-title-a']", "article a[href]"],
            "href_filters": ("duckduckgo.com",),
        },
    ]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        try:
            aggregated_candidates: List[Dict[str, Any]] = []
            seen_urls = set()
            search_screenshots: List[Dict[str, str]] = []

            for target in search_targets:
                await page.goto(target["url"], wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(5000)
                screenshot_path = artifact_dir / f"search_results_{target['name']}.png"
                await page.screenshot(path=str(screenshot_path), full_page=True)
                search_screenshots.append(
                    {
                        "engine": target["name"],
                        "screenshot_path": str(screenshot_path),
                    }
                )

                candidates: List[Dict[str, Any]] = []
                for selector in target["selectors"]:
                    try:
                        candidates = await page.eval_on_selector_all(
                            selector,
                            """
                            nodes => nodes.map(n => ({
                                url: n.href || n.getAttribute('href') || '',
                                title: (n.textContent || '').trim()
                            })).filter(item => item.url)
                            """,
                        )
                        if candidates:
                            break
                    except Exception:
                        continue

                for candidate in candidates:
                    link = candidate.get("url", "")
                    lowered = link.lower()
                    if any(blocked in lowered for blocked in target["href_filters"]):
                        continue
                    if lowered.startswith(("javascript:", "mailto:")):
                        continue
                    if link in seen_urls:
                        continue
                    seen_urls.add(link)
                    aggregated_candidates.append(
                        {
                            "url": link,
                            "title": candidate.get("title", ""),
                            "engine": target["name"],
                        }
                    )
                    if len(aggregated_candidates) >= max(count * 4, 20):
                        break

            primary_screenshot_path = search_screenshots[0]["screenshot_path"] if search_screenshots else ""
            return {
                "engine": "playwright-meta-search",
                "engines": [entry["engine"] for entry in search_screenshots],
                "search_query": search_query,
                "screenshot_path": primary_screenshot_path,
                "search_screenshots": search_screenshots,
                "candidates": aggregated_candidates[: max(count * 4, 20)],
            }
        except Exception:
            return {
                "engine": "",
                "engines": [],
                "search_query": search_query,
                "screenshot_path": "",
                "search_screenshots": [],
                "candidates": [],
            }
        finally:
            await browser.close()


if __name__ == "__main__":
    import sys

    loop = asyncio.get_event_loop()
    if len(sys.argv) > 1:
        test_id = sys.argv[1]
        loop.run_until_complete(capture_game_preview(test_id))
    else:
        loop.run_until_complete(
            capture_external_page(
                "https://www.crazygames.com/game/football-kicks",
                str(_proposal_artifact_dir("manual-test") / "external" / "candidate_01_render.png"),
            )
        )
