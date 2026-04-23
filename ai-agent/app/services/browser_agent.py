import os
import asyncio
import re
import time
import json
from io import BytesIO
from pathlib import Path
from playwright.async_api import async_playwright
from dotenv import load_dotenv
from PIL import Image
from app.db.postgres import (
    get_public_game_with_thumbnail_by_id,
    get_public_game_with_thumbnail_by_offset,
    close_postgres_pool,
)

load_dotenv()

# Pull credentials strictly from the .env file
BASE_URL = os.getenv("CLIENT_URL")
ADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL")
ADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD")

if not all([BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD]):
    raise ValueError(
        "CLIENT_URL, SUPERADMIN_EMAIL, and SUPERADMIN_PASSWORD must be strictly defined in the .env file."
    )


async def _wait_for_iframe_render(page, game_element, timeout_seconds: int = 30):
    deadline = time.monotonic() + timeout_seconds

    frame = None
    try:
        await page.wait_for_timeout(5000)
        handle = await game_element.element_handle()
        frame = await handle.content_frame() if handle else None
    except Exception:
        frame = None

    if frame is None:
        print("Could not inspect iframe content directly. Using visual readiness checks only.")

    percentage_only = re.compile(r"^\s*\d{1,3}%\s*$")
    loading_progress = re.compile(r"\b\d{1,3}%\b")
    splash_markers = [
        "made with unity",
        "unity",
        "rotate your screen",
        "loading",
        "download",
        "install",
    ]

    while time.monotonic() < deadline:
        body_text = ""
        if frame is not None:
            try:
                body_text = (await frame.locator("body").inner_text(timeout=1000)).strip()
            except Exception:
                body_text = ""

        lowered_body_text = body_text.lower()

        if percentage_only.match(body_text):
            print(f"Gameplay still loading inside iframe: {body_text}")
            await page.wait_for_timeout(1000)
            continue

        if loading_progress.search(body_text) and any(
            token in lowered_body_text for token in ["mb", "loading", "install", "download"]
        ):
            print(f"Gameplay still loading inside iframe: {body_text}")
            await page.wait_for_timeout(1500)
            continue

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
            center_bright = sum(1 for r, g, b in center_pixels if max(r, g, b) > 180)
            center_gray = sum(1 for r, g, b in center_pixels if abs(r - g) < 12 and abs(g - b) < 12 and 40 <= max(r, g, b) <= 170)
            center_dark_ratio = center_dark / center_total
            center_bright_ratio = center_bright / center_total
            center_gray_ratio = center_gray / center_total
        except Exception:
            black_ratio = 0.0
            bright_ratio = 0.0
            center_dark_ratio = 0.0
            center_bright_ratio = 0.0
            center_gray_ratio = 0.0

        screenshot_text = ""
        screenshot_text = lowered_body_text
        if frame is not None:
            try:
                screenshot_text = " ".join(
                    [
                        t.strip().lower()
                        for t in await frame.locator("body, div, span, p").all_inner_texts()
                        if t and t.strip()
                    ]
                )[:1000]
            except Exception:
                screenshot_text = lowered_body_text

        if black_ratio > 0.97 and bright_ratio < 0.02:
            print(f"Gameplay still looks like a loading screen (black_ratio={black_ratio:.2f}).")
            await page.wait_for_timeout(2000)
            continue

        if center_dark_ratio > 0.94:
            print("Gameplay still looks like a mostly-black loading screen.")
            await page.wait_for_timeout(2000)
            continue

        if any(marker in screenshot_text for marker in splash_markers):
            print("Gameplay still showing splash/loading text.")
            await page.wait_for_timeout(2000)
            continue

        if center_dark_ratio > 0.85 and center_gray_ratio > 0.08:
            print("Gameplay still looks like a splash screen.")
            await page.wait_for_timeout(2000)
            continue

        print("Gameplay iframe looks ready for capture.")
        await page.wait_for_timeout(1500)
        return

    print("Timed out waiting for loader to disappear. Capturing latest iframe state.")


async def capture_game_preview(proposal_id: str, output_path: str = "screenshot.png"):
    """
    Agent 1 (Day 1): Navigates to Arcade platform, logs in, and captures a screenshot of the game proposal.
    """
    print(f"Starting Agent 1 for Proposal ID: {proposal_id}")
    async with async_playwright() as p:
        # Launch browser in background (headless=True)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800}  # Standard desktop viewport
        )
        page = await context.new_page()

        try:
            print(f"Navigating to login: {BASE_URL}/admin/login...")
            await page.goto(f"{BASE_URL}/admin/login")

            #  Authenticate
            await page.fill('input[type="email"]', ADMIN_EMAIL)
            await page.fill('input[type="password"]', ADMIN_PASSWORD)
            await page.click('button[type="submit"]')

            print("Waiting for authentication to complete...")
            await page.wait_for_url("**/admin", timeout=15000)
            print("Successfully authenticated.")

            # Navigate to the actual playable game screen
            preview_url = f"{BASE_URL}/gameplay/{proposal_id}"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url)

            # Wait for the game engine to mount the canvas/iframe
            print("Waiting for game engine to mount...")
            await page.wait_for_selector("iframe", state="visible", timeout=15000)

            game_element = page.locator("iframe").first
            await _wait_for_iframe_render(page, game_element)

            # Dismiss any cookie banners or "Accept" overlays that block the view
            try:
                accept_button = page.get_by_role("button", name="Accept")
                if await accept_button.is_visible():
                    print("Dismissing cookie banner...")
                    await accept_button.click()
                    await page.wait_for_timeout(1000)
            except Exception:
                pass

            # Capture ONLY the game iframe to reduce visual noise for the AI
            print("Capturing precision screenshot of the game iframe...")
            await game_element.screenshot(path=output_path)
            print(f"Precision game screenshot successfully saved to {output_path}")

            return output_path

        except Exception as e:
            print(f"Error during browser automation: {e}")
            raise e
        finally:
            await browser.close()


def _resolve_thumbnail_url(game_row: dict | None) -> str | None:
    if not game_row:
        return None

    variants = game_row.get("variants") or {}
    if isinstance(variants, dict):
        for key in ("large", "medium", "thumbnail"):
            if variants.get(key):
                return variants[key]

    s3_key = game_row.get("s3Key")
    if s3_key:
        return f"https://cdn.arcadesbox.org/{s3_key}"

    return None


async def capture_thumbnail_preview(thumbnail_url: str, output_path: str = "thumbnail.png"):
    print(f"Capturing thumbnail from: {thumbnail_url}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800}
        )
        page = await context.new_page()

        try:
            await page.set_content(
                f"""
                <html>
                  <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;">
                    <img src="{thumbnail_url}" style="max-width:100%;max-height:100vh;object-fit:contain;" />
                  </body>
                </html>
                """,
                wait_until="load",
            )
            await page.wait_for_selector("img", state="visible", timeout=15000)
            await page.locator("img").screenshot(path=output_path)
            print(f"Thumbnail screenshot successfully saved to {output_path}")
            return output_path
        finally:
            await browser.close()


async def capture_external_page(url: str, output_path: str):
    """
    Stage 0 (Visual Librarian): Captures a screenshot of an external search result
    for visual correlation with our internal game assets.
    """
    print(f"Investigating external source: {url}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            # Switch to domcontentloaded to avoid getting stuck on heavy ads/trackers
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(3000)

            await _dismiss_common_overlays(page)
            await _click_start_controls(page)

            game_element = await _locate_external_game_surface(page)
            if game_element is None:
                print(f"Capture failed for {url}: no visible playable iframe/canvas found")
                return None

            await game_element.scroll_into_view_if_needed(timeout=5000)
            await page.wait_for_timeout(1200)
            await _dismiss_common_overlays(page)

            if (await game_element.evaluate("el => el.tagName.toLowerCase()")) == "iframe":
                await _wait_for_iframe_render(page, game_element)
            else:
                await page.wait_for_timeout(5000)

            await game_element.screenshot(path=output_path)
            metadata_path = str(Path(output_path).with_suffix(".json"))
            metadata = await _extract_external_page_metadata(page, url)
            Path(metadata_path).write_text(json.dumps(metadata, indent=2), encoding="utf-8")

            print(f"External gameplay capture saved to {output_path}")
            return {
                "screenshot_path": output_path,
                "metadata_path": metadata_path,
                "metadata": metadata,
            }

        except Exception as e:
            print(f"Capture failed for {url}: {e}")
            return None
        finally:
            await browser.close()


async def _dismiss_common_overlays(page):
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


async def _click_start_controls(page):
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


async def _locate_external_game_surface(page):
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

                score = await _score_external_game_surface(candidate, box)
                if score > best_score:
                    best_score = score
                    best_candidate = candidate
        except Exception:
            continue

    if best_candidate is not None and best_score >= 0:
        return best_candidate
    return None


async def _score_external_game_surface(candidate, box) -> float:
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
              return {
                self: collect(el),
                parent: collect(parent),
                grandParent: collect(grandParent),
                tagName: (el.tagName || "").toLowerCase(),
              };
            }
            """
        )
    except Exception:
        attrs = {"self": {}, "parent": {}, "grandParent": {}, "tagName": ""}

    flattened = " ".join(
        [
            str(value).lower()
            for scope in ("self", "parent", "grandParent")
            for value in (attrs.get(scope) or {}).values()
            if value
        ]
    )

    ad_markers = [
        "doubleclick",
        "googlesyndication",
        "adservice",
        "adnxs",
        "taboola",
        "outbrain",
        "prebid",
        "banner",
        "sponsor",
        "advert",
        "google_ads",
        "adsystem",
        "adsense",
        "vast",
    ]
    game_markers = [
        "game",
        "player",
        "unity",
        "html5",
        "webgl",
        "ruffle",
        "embed",
        "play",
        "iframe",
        "canvas",
    ]

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


async def _extract_external_page_metadata(page, source_url: str) -> dict:
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
            Array.from(document.querySelectorAll(selector))
              .map((el) => normalize(el.textContent))
              .filter(Boolean);
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
            if (question && answer) {
              faqItems.push({ question, answer });
            }
          }

          const ldJsonBlocks = Array.from(document.querySelectorAll("script[type='application/ld+json']"))
            .map((el) => {
              try { return JSON.parse(el.textContent || "{}"); } catch { return null; }
            })
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

          const categorySelectors = [
            "[rel='category tag']",
            ".category",
            ".categories a",
            "[class*='category'] a",
            ".breadcrumb a",
            "[class*='breadcrumb'] a"
          ];
          const tagSelectors = [
            ".tags a",
            "[class*='tag'] a",
            "a[rel='tag']"
          ];
          const ratingSelectors = [
            "[itemprop='ratingValue']",
            "[class*='rating']",
            "[class*='score']",
            "[class*='votes']",
            "[class*='vote']"
          ];
          const developerSelectors = [
            "[class*='developer']",
            "[class*='publisher']",
            "[data-testid*='developer']",
            "[data-testid*='publisher']"
          ];
          const headings = Array.from(document.querySelectorAll("h1, h2"))
            .map((el) => normalize(el.textContent))
            .filter(Boolean)
            .slice(0, 20);
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
            developer_publisher: unique(
                developerSelectors.flatMap((selector) => textFrom(selector))
            ).slice(0, 20),
            ratings_and_votes: unique(
              ratingSelectors.flatMap((selector) => textFrom(selector))
            ).slice(0, 20),
            tags: unique(
              tagSelectors.flatMap((selector) => textFrom(selector))
            ).slice(0, 20),
            categories: unique(
              categorySelectors.flatMap((selector) => textFrom(selector))
            ).slice(0, 20),
          };
        }
        """
    )
    data["source_url"] = source_url
    return data


async def _run_cli() -> None:
    import sys

    if len(sys.argv) > 1:
        target_id = sys.argv[1]
        game_row = await get_public_game_with_thumbnail_by_id(target_id)
        if not game_row:
            raise RuntimeError(f"Could not fetch game {target_id} from public.games")
    else:
        game_row = await get_public_game_with_thumbnail_by_offset(1)
        if not game_row:
            raise RuntimeError("Could not fetch a game id from public.games")
        target_id = str(game_row["id"])
        print(f"Fetched game from public.games: {game_row.get('title', 'Unknown')} ({target_id})")

    thumbnail_url = _resolve_thumbnail_url(game_row)
    if thumbnail_url:
        await capture_thumbnail_preview(thumbnail_url, f"test_thumbnail_{target_id}.png")
    else:
        print(f"No thumbnail URL found for {target_id}")

    try:
        await capture_game_preview(target_id, f"test_internal_{target_id}.png")
    finally:
        await close_postgres_pool()


if __name__ == "__main__":
    asyncio.run(_run_cli())
