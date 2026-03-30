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


if __name__ == "__main__":
    # Test with valid game IDs from the database to verify the player screenshot
    test_ids = ["d1fbe524-b5e6-434c-91c4-bd3e7032fc72"]

    for pid in test_ids:
        try:
            asyncio.run(capture_game_preview(pid, f"screenshot_{pid}.png"))
        except Exception as err:
            print(f"Failed capture for {pid}: {err}")
