import json
import re
import time
from io import BytesIO
from typing import Any, Dict

from PIL import Image
from playwright.async_api import Page


async def dismiss_accept_overlay(page: Page) -> None:
    try:
        accept_button = page.get_by_role("button", name="Accept")
        if await accept_button.is_visible():
            await accept_button.click()
            await page.wait_for_timeout(1000)
    except Exception:
        return


async def sample_frame_ratios(game_element: Any) -> tuple[float, float, float, float]:
    try:
        screenshot_bytes = await game_element.screenshot()
        image = Image.open(BytesIO(screenshot_bytes)).convert("RGB").resize((160, 90))
        pixels = list(image.getdata())
        total_pixels = max(len(pixels), 1)
        black_pixels = sum(1 for r, g, b in pixels if max(r, g, b) < 24)
        bright_pixels = sum(1 for r, g, b in pixels if max(r, g, b) > 180)
        black_ratio = black_pixels / total_pixels
        bright_ratio = bright_pixels / total_pixels
        center_crop = image.crop((40, 20, 120, 70))
        center_pixels = list(center_crop.getdata())
        center_total = max(len(center_pixels), 1)
        center_dark = sum(1 for r, g, b in center_pixels if max(r, g, b) < 40)
        center_gray = sum(
            1
            for r, g, b in center_pixels
            if abs(r - g) < 12 and abs(g - b) < 12 and 40 <= max(r, g, b) <= 170
        )
        return black_ratio, bright_ratio, center_dark / center_total, center_gray / center_total
    except Exception:
        return 0.0, 0.0, 0.0, 0.0


async def wait_for_iframe_render(page: Page, game_element: Any, timeout_seconds: int = 30) -> None:
    deadline = time.monotonic() + timeout_seconds
    frame = None
    try:
        await page.wait_for_timeout(5000)
        handle = await game_element.element_handle()
        frame = await handle.content_frame() if handle else None
    except Exception:
        frame = None

    percentage_only = re.compile(r"^\s*\d{1,3}%\s*$")
    loading_progress = re.compile(r"\b\d{1,3}%\b")
    splash_markers = ["made with unity", "unity", "rotate your screen", "loading", "download", "install"]

    while time.monotonic() < deadline:
        body_text = ""
        if frame is not None:
            try:
                body_text = (await frame.locator("body").inner_text(timeout=1000)).strip()
            except Exception:
                body_text = ""
        lowered_body_text = body_text.lower()
        if percentage_only.match(body_text):
            await page.wait_for_timeout(1000)
            continue
        if loading_progress.search(body_text) and any(token in lowered_body_text for token in ["mb", "loading", "install", "download"]):
            await page.wait_for_timeout(1500)
            continue

        black_ratio, bright_ratio, center_dark_ratio, center_gray_ratio = await sample_frame_ratios(game_element)
        screenshot_text = lowered_body_text
        if frame is not None:
            try:
                screenshot_text = " ".join(
                    [text.strip().lower() for text in await frame.locator("body, div, span, p").all_inner_texts() if text and text.strip()]
                )[:1000]
            except Exception:
                screenshot_text = lowered_body_text

        if black_ratio > 0.97 and bright_ratio < 0.02:
            await page.wait_for_timeout(2000)
            continue
        if center_dark_ratio > 0.94:
            await page.wait_for_timeout(2000)
            continue
        if any(marker in screenshot_text for marker in splash_markers):
            await page.wait_for_timeout(2000)
            continue
        if center_dark_ratio > 0.85 and center_gray_ratio > 0.08:
            await page.wait_for_timeout(2000)
            continue

        await page.wait_for_timeout(1500)
        return


async def dismiss_common_overlays(page: Page) -> None:
    selectors = [
        "button:has-text('Accept')",
        "button:has-text('I Agree')",
        "button:has-text('OK')",
        "button:has-text('Got it')",
        "[aria-label='Close']",
        "[aria-label='Dismiss']",
        ".close",
        ".close-button",
        ".modal-close",
        "#cookie-accept",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.is_visible():
                await locator.click(timeout=1000)
                await page.wait_for_timeout(400)
        except Exception:
            continue


async def click_start_controls(page: Page) -> None:
    selectors = [
        "button:has-text('Play')",
        "button:has-text('Start')",
        "button:has-text('Play Now')",
        "button:has-text('Continue')",
        ".play-button",
        ".start-button",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.is_visible():
                await locator.click(timeout=1000)
                await page.wait_for_timeout(1200)
                return
        except Exception:
            continue


async def score_external_game_surface(candidate: Any, box: Dict[str, Any]) -> float:
    try:
        attrs = await candidate.evaluate(
            """
            (el) => {
              const collect = (node) => ({
                id: node?.id || "",
                className: typeof node?.className === "string" ? node.className : "",
                title: node?.getAttribute?.("title") || "",
                name: node?.getAttribute?.("name") || "",
                src: node?.getAttribute?.("src") || "",
                ariaLabel: node?.getAttribute?.("aria-label") || "",
                dataTestId: node?.getAttribute?.("data-testid") || "",
              });
              const parent = el.parentElement;
              const grandParent = parent?.parentElement;
              return { self: collect(el), parent: collect(parent), grandParent: collect(grandParent), tagName: (el.tagName || "").toLowerCase() };
            }
            """
        )
    except Exception:
        attrs = {"self": {}, "parent": {}, "grandParent": {}, "tagName": ""}

    flattened = " ".join(
        str(value).lower()
        for scope in ("self", "parent", "grandParent")
        for value in (attrs.get(scope) or {}).values()
        if value
    )
    ad_markers = ["doubleclick", "googlesyndication", "adservice", "adnxs", "taboola", "outbrain", "prebid", "banner", "sponsor", "advert", "google_ads", "adsystem", "adsense", "vast"]
    game_markers = ["game", "player", "unity", "html5", "webgl", "ruffle", "embed", "play", "iframe", "canvas"]

    score = 0.0
    area = box["width"] * box["height"]
    score += min(area / 50000, 40)
    score += min(box["width"] / 40, 20)
    score += min(box["height"] / 30, 20)
    if any(marker in flattened for marker in ad_markers):
        score -= 120
    if any(marker in flattened for marker in game_markers):
        score += 25
    if attrs.get("tagName") == "canvas":
        score += 15
    if "game" in flattened and "ad" not in flattened:
        score += 10
    return score


async def locate_external_game_surface(page: Page):
    selectors = [
        "[id*='game'] iframe",
        "[class*='game'] iframe",
        "[data-testid*='game'] iframe",
        "[id*='player'] iframe",
        "[class*='player'] iframe",
        "main iframe",
        "iframe",
        "[id*='game'] canvas",
        "[class*='game'] canvas",
        "[data-testid*='game'] canvas",
        "[id*='player'] canvas",
        "[class*='player'] canvas",
        "main canvas",
        "canvas",
    ]
    best_candidate = None
    best_score = float("-inf")
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
            for index in range(count):
                candidate = locator.nth(index)
                if not await candidate.is_visible():
                    continue
                box = await candidate.bounding_box()
                if not box or box["width"] < 320 or box["height"] < 220:
                    continue
                score = await score_external_game_surface(candidate, box)
                if score > best_score:
                    best_score = score
                    best_candidate = candidate
        except Exception:
            continue
    return best_candidate if best_candidate is not None and best_score >= 0 else None


async def extract_external_page_metadata(page: Page, source_url: str) -> Dict[str, Any]:
    data = await page.evaluate(
        """
        () => {
          const getMeta = (name) =>
            document.querySelector(`meta[name="${name}"]`)?.content ||
            document.querySelector(`meta[property="${name}"]`)?.content ||
            "";
          const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
          const unique = (items) => Array.from(new Set(items.filter(Boolean)));
          const textFrom = (selector) =>
            Array.from(document.querySelectorAll(selector)).map((el) => normalize(el.textContent)).filter(Boolean);
          const sectionText = (headingRegex) => {
            const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
            for (const heading of headings) {
              const label = normalize(heading.textContent).toLowerCase();
              if (!headingRegex.test(label)) continue;
              const chunks = [];
              let node = heading.nextElementSibling;
              while (node && !/^H[1-4]$/.test(node.tagName)) {
                const text = normalize(node.textContent);
                if (text) chunks.push(text);
                node = node.nextElementSibling;
              }
              if (chunks.length) return chunks.join("\\n\\n");
            }
            return "";
          };
          const faqItems = [];
          const faqQuestions = Array.from(document.querySelectorAll("details, .faq-item, .faq, [class*='faq']"));
          for (const item of faqQuestions) {
            let question = "";
            let answer = "";
            const summary = item.querySelector("summary");
            if (summary) {
              question = normalize(summary.textContent);
              const clone = item.cloneNode(true);
              const cloneSummary = clone.querySelector("summary");
              if (cloneSummary) cloneSummary.remove();
              answer = normalize(clone.textContent);
            } else {
              const questionNode = item.querySelector("h2, h3, h4, strong, b, .question, [class*='question']");
              const answerNode = item.querySelector("p, .answer, [class*='answer']");
              question = normalize(questionNode?.textContent || "");
              answer = normalize(answerNode?.textContent || item.textContent);
            }
            if (question && answer) faqItems.push({ question, answer });
          }

          const ldJsonBlocks = Array.from(document.querySelectorAll("script[type='application/ld+json']"))
            .map((el) => { try { return JSON.parse(el.textContent || "{}"); } catch { return null; } })
            .filter(Boolean);
          for (const block of ldJsonBlocks) {
            const nodes = Array.isArray(block) ? block : [block];
            for (const node of nodes) {
              if ((node['@type'] || '').toLowerCase().includes('faq') && Array.isArray(node.mainEntity)) {
                for (const entity of node.mainEntity) {
                  const question = normalize(entity.name);
                  const answer = normalize(entity.acceptedAnswer?.text || entity.acceptedAnswer?.['@value'] || "");
                  if (question && answer) faqItems.push({ question, answer });
                }
              }
            }
          }

          const categorySelectors = ["[rel='category tag']", ".category", ".categories a", "[class*='category'] a", ".breadcrumb a", "[class*='breadcrumb'] a"];
          const tagSelectors = [".tags a", "[class*='tag'] a", "a[rel='tag']"];
          const ratingSelectors = ["[itemprop='ratingValue']", "[class*='rating']", "[class*='score']", "[class*='votes']", "[class*='vote']"];
          const developerSelectors = ["[class*='developer']", "[class*='publisher']", "[data-testid*='developer']", "[data-testid*='publisher']"];
          const headings = Array.from(document.querySelectorAll("h1, h2")).map((el) => normalize(el.textContent)).filter(Boolean).slice(0, 20);
          return {
            final_url: location.href,
            source_url: "",
            title: document.title || "",
            meta_description: getMeta("description"),
            og_title: getMeta("og:title"),
            og_description: getMeta("og:description"),
            og_image: getMeta("og:image"),
            canonical_url: document.querySelector("link[rel='canonical']")?.href || "",
            headings,
            faq_items: unique(faqItems.map((item) => JSON.stringify(item))).map((item) => JSON.parse(item)).slice(0, 20),
            about_game: sectionText(/about|about this game|game description|overview/i),
            how_to_play: sectionText(/how to play|how do you play|gameplay/i),
            instructions: sectionText(/instructions|controls|control|guide/i),
            developer_publisher: unique(developerSelectors.flatMap((selector) => textFrom(selector))).slice(0, 20),
            ratings_and_votes: unique(ratingSelectors.flatMap((selector) => textFrom(selector))).slice(0, 20),
            tags: unique(tagSelectors.flatMap((selector) => textFrom(selector))).slice(0, 20),
            categories: unique(categorySelectors.flatMap((selector) => textFrom(selector))).slice(0, 20),
          };
        }
        """
    )
    data["source_url"] = source_url
    return data
