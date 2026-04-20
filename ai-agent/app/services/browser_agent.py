import os
import asyncio
from playwright.async_api import async_playwright
from dotenv import load_dotenv

load_dotenv()

# Pull credentials strictly from the .env file
BASE_URL = os.getenv("CLIENT_URL")
ADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL")
ADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD")

if not all([BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD]):
    raise ValueError(
        "CLIENT_URL, SUPERADMIN_EMAIL, and SUPERADMIN_PASSWORD must be strictly defined in the .env file."
    )


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

            await page.wait_for_timeout(5000)

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
            game_element = page.locator("iframe")
            await game_element.screenshot(path=output_path)
            print(f"Precision game screenshot successfully saved to {output_path}")

            return output_path

        except Exception as e:
            print(f"Error during browser automation: {e}")
            raise e
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
            # Set a generous timeout for potentially heavy gaming sites
            await page.goto(url, wait_until="networkidle", timeout=30000)
            
            # 1. Clear common obstructions (cookie banners, overlays)
            for selector in ["button:contains('Accept')", "button:contains('OK')", "#cookie-accept"]:
                try:
                    btn = page.locator(selector).first
                    if await btn.is_visible():
                        await btn.click()
                        await page.wait_for_timeout(500)
                except: continue

            # 2. Capture the viewport
            await page.screenshot(path=output_path)
            print(f"External capture saved to {output_path}")
            return output_path

        except Exception as e:
            print(f"Capture failed for {url}: {e}")
            return None
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
