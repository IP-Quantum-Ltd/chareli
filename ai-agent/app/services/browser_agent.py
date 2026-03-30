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

            # Navigate to game preview page
            # Correct route based on routes.tsx is /admin/proposals/:id/review
            preview_url = f"{BASE_URL}/admin/proposals/{proposal_id}/review"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url)

            # Wait for the page, images, and canvases to fully load
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)

            # Capture full page screenshot
            await page.screenshot(path=output_path, full_page=True)
            print(f"Screenshot successfully saved to {output_path}")

            return output_path

        except Exception as e:
            print(f"Error during browser automation: {e}")
            raise e
        finally:
            await browser.close()


if __name__ == "__main__":
    test_ids = ["9927a533-92e2-40b5-956c-9bb7f9059b4d"]

    for pid in test_ids:
        try:
            asyncio.run(capture_game_preview(pid, f"screenshot_{pid}.png"))
        except Exception as err:
            print(f"Failed capture for {pid}: {err}")
