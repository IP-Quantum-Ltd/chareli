import asyncio
from playwright.async_api import async_playwright
from app.config import settings

# Pull credentials strictly from the settings
BASE_URL = settings.CLIENT_URL
ADMIN_EMAIL = settings.SUPERADMIN_EMAIL
ADMIN_PASSWORD = settings.SUPERADMIN_PASSWORD

if not all([BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD]):
    raise ValueError(
        "CLIENT_URL, SUPERADMIN_EMAIL, and SUPERADMIN_PASSWORD must be strictly defined in the .env file."
    )


async def capture_game_preview(proposal_id: str, output_path_prefix: str = "internal"):
    """
    Agent 1 (Day 1): Navigates to Arcade platform, logs in, and captures TWO screenshots 
    of the game proposal (offset by 5 seconds) for visual consistency checking.
    """
    print(f"Starting Agent 1 for Proposal ID: {proposal_id}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            print(f"Navigating to login: {BASE_URL}/admin/login...")
            await page.goto(f"{BASE_URL}/admin/login")

            await page.fill('input[type="email"]', ADMIN_EMAIL)
            await page.fill('input[type="password"]', ADMIN_PASSWORD)
            await page.click('button[type="submit"]')

            await page.wait_for_url("**/admin", timeout=30000)
            print("Successfully authenticated.")

            preview_url = f"{BASE_URL}/gameplay/{proposal_id}"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url)

            # Increased to 30s for staging loading screens
            await page.wait_for_selector("iframe", state="visible", timeout=30000)
            game_element = page.locator("iframe")

            # Capture 1: Initial state (after 5s)
            print("Waiting for initial frame...")
            await page.wait_for_timeout(5000)
            path_a = f"{output_path_prefix}_A_{proposal_id}.png"
            await game_element.screenshot(path=path_a)
            
            # Capture 2: Advanced state (after another 5s)
            print("Waiting for second frame...")
            await page.wait_for_timeout(5000)
            path_b = f"{output_path_prefix}_B_{proposal_id}.png"
            await game_element.screenshot(path=path_b)

            print(f"Dual internal captures saved: {path_a}, {path_b}")
            return [path_a, path_b]

        except Exception as e:
            error_screenshot = f"error_capture_{proposal_id}.png"
            await page.screenshot(path=error_screenshot)
            print(f"Error during internal browser automation: {e}. Saved debug screenshot to {error_screenshot}")
            raise e
        finally:
            await browser.close()


async def capture_external_page(url: str, output_path: str):
    """
    Stage 0 (Visual Librarian): Captures a screenshot of an external search result.
    Extended wait time (10s) to ensure heavy game assets are settled.
    """
    print(f"Investigating external source: {url}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="networkidle", timeout=60000)
            
            # WAIT Logic: 10 seconds per your latest requirement
            print("Waiting 10s for external assets to stabilize...")
            await page.wait_for_timeout(10000)
            
            # Dismiss banners
            for selector in ["button:contains('Accept')", "button:contains('OK')", "#cookie-accept"]:
                try:
                    btn = page.locator(selector).first
                    if await btn.is_visible():
                        await btn.click()
                        await page.wait_for_timeout(500)
                except: continue

            await page.screenshot(path=output_path, full_page=True)
            print(f"External capture saved: {output_path}")
            return output_path

        except Exception as e:
            print(f"Capture failed for {url}: {e}")
            return None
        finally:
            await browser.close()


async def search_for_urls(game_title: str, count: int = 5) -> list[str]:
    """
    [ZERO-API SEARCH] Bypasses Tavily/Serper by using Playwright to scrape DuckDuckGo.
    """
    print(f"Perfroming browser-based search for: {game_title}")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        page = await context.new_page()
        
        try:
            query = f"{game_title} arcade browser game play online"
            search_url = f"https://duckduckgo.com/?q={query.replace(' ', '+')}"
            
            await page.goto(search_url, wait_until="networkidle")
            await page.wait_for_selector(".result__a", timeout=10000)
            
            # Extract top N organic links
            links = await page.eval_on_selector_all(".result__a", "nodes => nodes.map(n => n.href)")
            
            # Filter out advertisements or non-game sites if possible, or just return top organic
            results = links[:count]
            print(f"Found {len(results)} candidate URLs via browser search.")
            return results
        except Exception as e:
            print(f"Search failed: {e}")
            return []
        finally:
            await browser.close()



if __name__ == "__main__":
    # Test internal and external capture
    import sys
    loop = asyncio.get_event_loop()
    if len(sys.argv) > 1:
        test_id = sys.argv[1]
        loop.run_until_complete(capture_game_preview(test_id, f"test_internal_{test_id}.png"))
    else:
        # Test external capture on a popular game site
        loop.run_until_complete(capture_external_page("https://www.crazygames.com/game/football-kicks", "test_external.png"))
