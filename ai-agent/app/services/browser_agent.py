import os
import asyncio
import re
import time
import json
from io import BytesIO
from pathlib import Path
from urllib.parse import quote_plus
from playwright.async_api import async_playwright
from dotenv import load_dotenv
from PIL import Image

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
    """
    Advanced pixel and text detection to ensure the game has finished loading 
    its engine (Unity/HTML5) before we snap the photo.
    """
    deadline = time.monotonic() + timeout_seconds

    try:
        await page.wait_for_timeout(5000)
        handle = await game_element.element_handle()
        frame = await handle.content_frame() if handle else None
    except Exception:
        frame = None

    if frame is None:
        print("Could not inspect iframe content directly. Using time-based fallback.")
        await page.wait_for_timeout(10000)
        return

    percentage_only = re.compile(r"^\s*\d{1,3}%\s*$")
    loading_progress = re.compile(r"\b\d{1,3}%\b")
    splash_markers = ["made with unity", "unity", "rotate your screen", "loading", "download", "install"]

    while time.monotonic() < deadline:
        try:
            body_text = (await frame.locator("body").inner_text(timeout=1000)).strip()
        except Exception:
            body_text = ""

        lowered_body_text = body_text.lower()

        if percentage_only.match(body_text) or (loading_progress.search(body_text) and any(t in lowered_body_text for t in ["mb", "loading"])):
            print(f"Gameplay still loading inside iframe: {body_text}")
            await page.wait_for_timeout(1500)
            continue

        try:
            screenshot_bytes = await game_element.screenshot()
            image = Image.open(BytesIO(screenshot_bytes)).convert("RGB").resize((160, 90))
            pixels = list(image.getdata())
            total_pixels = max(len(pixels), 1)
            black_pixels = sum(1 for r, g, b in pixels if max(r, g, b) < 24)
            black_ratio = black_pixels / total_pixels
            
            if black_ratio > 0.97:
                print(f"Gameplay still looks like a loading screen (black_ratio={black_ratio:.2f}).")
                await page.wait_for_timeout(2000)
                continue
        except Exception: pass

        if any(marker in lowered_body_text for marker in splash_markers):
            print("Gameplay still showing splash/loading text.")
            await page.wait_for_timeout(2000)
            continue

        print("Gameplay iframe looks ready for capture.")
        await page.wait_for_timeout(1500)
        return

    print("Timed out waiting for loader to disappear. Capturing latest iframe state.")


async def capture_game_preview(game_id: str, output_path: str = "screenshot.png"):
    """
    Agent 1: Navigates to Arcade platform, logs in, and captures a precision 
    screenshot of the game asset using pixel-perfect detection.
    """
    print(f"Starting Agent 1 for Game ID: {game_id}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            print(f"Navigating to login: {BASE_URL}/login...")
            await page.goto(f"{BASE_URL}/login")
            await page.fill('input[type="email"]', ADMIN_EMAIL)
            await page.fill('input[type="password"]', ADMIN_PASSWORD)
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(5000) 

            preview_url = f"{BASE_URL}/gameplay/{game_id}"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url)
            await page.wait_for_selector("iframe", state="visible", timeout=15000)

            game_element = page.locator("iframe").first
            await _wait_for_iframe_render(page, game_element)

            print("Capturing precision screenshot of the game iframe...")
            await game_element.screenshot(path=output_path)
            return output_path
        except Exception as e:
            print(f"Error during browser automation: {e}")
            raise e
        finally:
            await browser.close()


async def capture_external_page(url: str, output_path: str):
    """Stage 0: Captures an external page with autonomous navigation."""
    print(f"Investigating external source: {url}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(3000)
            await _dismiss_common_overlays(page)
            await _click_start_controls(page)

            game_element = await _locate_external_game_surface(page)
            if game_element:
                if (await game_element.evaluate("el => el.tagName.toLowerCase()")) == "iframe":
                    await _wait_for_iframe_render(page, game_element)
                await game_element.screenshot(path=output_path)
                return {"screenshot_path": output_path, "mode": "precision"}
            
            await page.screenshot(path=output_path, full_page=True)
            return {"screenshot_path": output_path, "mode": "full_page"}
        except Exception as e:
            print(f"Capture failed for {url}: {e}")
            return None
        finally:
            await browser.close()

async def _dismiss_common_overlays(page):
    selectors = ["button:has-text('Accept')", "button:has-text('OK')", "#cookie-accept"]
    for s in selectors:
        try:
            btn = page.locator(s).first
            if await btn.is_visible(): await btn.click(timeout=1000)
        except: continue

async def _click_start_controls(page):
    selectors = ["button:has-text('Play')", "button:has-text('Start')", ".play-button"]
    for s in selectors:
        try:
            btn = page.locator(s).first
            if await btn.is_visible():
                await btn.click(timeout=1000)
                await page.wait_for_timeout(1000)
                return
        except: continue

async def _locate_external_game_surface(page):
    selectors = ["iframe", "canvas", "[id*='game'] iframe"]
    for s in selectors:
        try:
            loc = page.locator(s).first
            if await loc.is_visible(): return loc
        except: continue
    return None

async def search_for_urls(search_query: str, output_dir: str, count: int = 5) -> dict:
    """Multi-engine meta-search (Google, Bing, Brave, DDG)."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    engines = [
        ("google", f"https://www.google.com/search?q={quote_plus(search_query)}"),
        ("bing", f"https://www.bing.com/search?q={quote_plus(search_query)}"),
        ("brave", f"https://search.brave.com/search?q={quote_plus(search_query)}")
    ]
    collected = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        for name, url in engines:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(2000)
                links = await page.evaluate("() => Array.from(document.querySelectorAll('a[href]')).map(a => ({title: a.innerText, url: a.href}))")
                for l in links:
                    if l['url'].startswith("http") and not any(b in l['url'] for b in ["google.com", "bing.com", "brave.com"]):
                        collected.append({"title": l['title'], "url": l['url'], "engine": name})
            except: continue
        await browser.close()
    return {"candidates": collected[:count*2]}
