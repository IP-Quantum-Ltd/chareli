import os
import asyncio
import re
import time
import json
from io import BytesIO
from pathlib import Path
from urllib.parse import quote_plus
from playwright.async_api import async_playwright
from PIL import Image
from app.config import settings

async def _wait_for_iframe_render(page, game_element, timeout_seconds: int = 45):
    """
    Advanced pixel and text detection to ensure the game has finished loading 
    its engine (Unity/HTML5) before we snap the final photo.
    """
    deadline = time.monotonic() + timeout_seconds

    try:
        await page.wait_for_timeout(3000)
        handle = await game_element.element_handle()
        frame = await handle.content_frame() if handle else None
    except Exception:
        frame = None

    if frame is None:
        print("Could not inspect iframe content directly. Using time-based fallback.")
        await page.wait_for_timeout(10000)
        return

    splash_markers = ["made with unity", "unity", "loading", "download", "getting your game ready", "%", "progress"]
 
    while time.monotonic() < deadline:
        try:
            body_text = (await frame.locator("body").inner_text(timeout=1000)).strip().lower()
            
            # Check for generic loading text
            if any(m in body_text for m in splash_markers):
                print(f"Gameplay still loading inside iframe ('{body_text[:50]}...').")
                await page.wait_for_timeout(3000)
                continue
 
            # Snapshot 1: Current state
            snap1_bytes = await game_element.screenshot()
            image1 = Image.open(BytesIO(snap1_bytes)).convert("RGB").resize((160, 90))
            pixels1 = list(image1.getdata())
            
            # Variance check (Solid Slabs/Loading screens)
            avg_r, avg_g, avg_b = sum(p[0] for p in pixels1)/len(pixels1), sum(p[1] for p in pixels1)/len(pixels1), sum(p[2] for p in pixels1)/len(pixels1)
            variance = sum((p[0]-avg_r)**2 + (p[1]-avg_g)**2 + (p[2]-avg_b)**2 for p in pixels1) / len(pixels1)
            
            if variance < 150: # Lowered from 300 to allow minimalist splash screens
                print(f"Gameplay looks too simplistic/void-like (Var: {variance:.2f}). Waiting...")
                await page.wait_for_timeout(4000)
                continue

            # Churn check (Detects moving percentage bars vs static logos)
            await page.wait_for_timeout(2500)
            snap2_bytes = await game_element.screenshot()
            image2 = Image.open(BytesIO(snap2_bytes)).convert("RGB").resize((160, 90))
            pixels2 = list(image2.getdata())
            
            churn = sum(abs(p1[0]-p2[0]) + abs(p1[1]-p2[1]) + abs(p1[2]-p2[2]) for p1, p2 in zip(pixels1, pixels2)) / len(pixels1)
            
            if churn < 1.0: 
                print(f"Gameplay looks static (Churn: {churn:.2f}). Waiting for activity...")
                await page.wait_for_timeout(2000)
                continue

            # NEW: Settle window to ensure we aren't just capturing the 'climax' of a progress bar
            print(f"Activity detected (Churn: {churn:.2f}). Giving the engine 4s to settle...")
            await page.wait_for_timeout(4000)
            return
        except Exception: 
            await page.wait_for_timeout(1000)


async def capture_game_preview(game_id: str, output_path: str = "screenshot.png"):
    """
    Agent 1: Navigates directly to the hosted gameplay screen.
    Uses settings.ARCADE_CLIENT_BASE_URL.
    """
    print(f"Starting Multi-Frame Agent 1 for Game ID: {game_id}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        try:
            # 1. Navigate directly to the public gameplay URL
            preview_url = f"{settings.ARCADE_CLIENT_BASE_URL}/gameplay/{game_id}"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url, wait_until="domcontentloaded", timeout=45000)

            # Dismiss banners immediately
            await _dismiss_common_overlays(page)

            # 2. Wait for Mount + Short Delay for meaningful first frame
            print("Waiting for game engine to mount...")
            await page.wait_for_selector("iframe", state="visible", timeout=20000)
            game_element = page.locator("iframe").first
            
            # Patience for splash screen before first frame
            await page.wait_for_timeout(6000) 
            
            initial_path = f"initial_{game_id}.png"
            await game_element.screenshot(path=initial_path)
            print(f"Initial frame captured: {initial_path}")

            # 3. Wait for stability and capture Final Frame (Gameplay)
            await _wait_for_iframe_render(page, game_element)
            
            # Re-dismiss any late-appearing overlays
            await _dismiss_common_overlays(page)

            final_path = f"final_{game_id}.png"
            await game_element.screenshot(path=final_path)
            print(f"Final gameplay frame captured: {final_path}")

            return {"paths": [initial_path, final_path]}

        except Exception as e:
            print(f"Error during staging capture: {e}")
            raise e
        finally:
            await browser.close()


async def capture_external_page(url: str, output_path: str):
    """Stage 0: Captures an external page with autonomous navigation."""
    print(f"Investigating external source: {url}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            # External sites are ad-heavy; wait longer for the base DOM
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(8000) # Initial soak time
            await _dismiss_common_overlays(page)
            await _click_start_controls(page)
            
            # Additional pause after clicking 'Start' for external engines to spin up
            await page.wait_for_timeout(5000)

            game_element = await _locate_external_game_surface(page)
            if game_element:
                # Be extra patient with external surfaces
                await _wait_for_iframe_render(page, game_element, timeout_seconds=60)
                await game_element.screenshot(path=output_path)
                return {"screenshot_path": output_path, "mode": "precision", "metadata": await _extract_external_page_metadata(page, url)}
            
            await page.screenshot(path=output_path, full_page=True)
            return {"screenshot_path": output_path, "mode": "full_page", "metadata": await _extract_external_page_metadata(page, url)}
        except Exception as e:
            print(f"Failed external capture for {url}: {e}")
            return None
        finally:
            await browser.close()

async def _dismiss_common_overlays(page):
    """Aggressively clears cookie banners and marketing overlays."""
    selectors = [
        "button:has-text('Accept')", 
        "button:has-text('OK')", 
        "#cookie-accept", 
        ".close-button",
        "button:has-text('Decline')",
        "[aria-label='Close']"
    ]
    for s in selectors:
        try:
            btn = page.locator(s).first
            if await btn.is_visible(): 
                await btn.click(timeout=1500)
                await page.wait_for_timeout(500) 
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

async def _extract_external_page_metadata(page, source_url: str) -> dict:
    try:
        data = await page.evaluate("() => ({ title: document.title, final_url: location.href })")
        data["source_url"] = source_url
        return data
    except:
        return {"title": "Unknown", "source_url": source_url}

async def search_for_urls(search_query: str, output_dir: str, count: int = 5) -> dict:
    """Multi-engine meta-search (Google, Brave, Bing)."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    engines = [
        ("google", f"https://www.google.com/search?q={quote_plus(search_query)}"),
        ("brave", f"https://search.brave.com/search?q={quote_plus(search_query)}"),
        ("bing", f"https://www.bing.com/search?q={quote_plus(search_query)}")
    ]
    
    collected = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1440, "height": 900}
        )
        page = await context.new_page()
        
        for name, url in engines:
            try:
                print(f"Meta-Search: Indexing {name} for '{search_query}'...")
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(2000)
                
                search_snap = output_path / f"search_{name}.png"
                await page.screenshot(path=str(search_snap))

                links = []
                if name == "google":
                    links = await page.evaluate("() => Array.from(document.querySelectorAll('div.g a')).map(a => ({title: a.innerText, url: a.href}))")
                elif name == "bing":
                    links = await page.evaluate("() => Array.from(document.querySelectorAll('li.b_algo h2 a')).map(a => ({title: a.innerText, url: a.href}))")
                else:
                    links = await page.evaluate("() => Array.from(document.querySelectorAll('a[href]')).map(a => ({title: a.innerText, url: a.href}))")

                for l in links:
                    target_url = l.get('url', '')
                    if target_url.startswith("http") and not any(b in target_url for b in ["google.com", "bing.com", "brave.com", "microsoft.com"]):
                        collected.append({
                            "title": l.get('title', 'Unknown'), 
                            "url": target_url, 
                            "engine": name, 
                            "screenshot_path": str(search_snap)
                        })
            except Exception:
                continue
                
        await browser.close()
        
    seen = set()
    unique_candidates = []
    for c in collected:
        if c['url'] not in seen:
            unique_candidates.append(c)
            seen.add(c['url'])
            
    return {
        "candidates": unique_candidates[:count*3], 
        "engine": "playwright-meta-search",
        "search_screenshots": [{"screenshot_path": str(output_path / f"search_{n}.png")} for n, _ in engines]
    }
