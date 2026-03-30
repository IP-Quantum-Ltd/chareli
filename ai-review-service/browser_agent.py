import os
import asyncio
from playwright.async_api import async_playwright
from dotenv import load_dotenv

load_dotenv()

# Use localhost for local testing (can be switched to dev/staging via .env)
BASE_URL = os.getenv("CLIENT_URL", "http://localhost:5173")
ADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "Admin123!")

async def capture_game_preview(proposal_id: str, output_path: str = "screenshot.png"):
    """
    Agent 1 (Day 1): Navigates to Arcade platform, logs in, and captures a screenshot of the game proposal.
    """
    print(f"Starting Agent 1 for Proposal ID: {proposal_id}")
    async with async_playwright() as p:
        # Launch browser in background (headless=True)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800} # Standard desktop viewport
        )
        page = await context.new_page()

        try:
            print(f"Navigating to login: {BASE_URL}/login...")
            await page.goto(f"{BASE_URL}/login")
            
            # Step 1: Authenticate
            # We assume standard input types based on React/Vue generic forms. 
            # We will likely need to adjust these selectors if the Arcade login form uses different IDs/classes.
            await page.fill('input[type="email"]', ADMIN_EMAIL)
            await page.fill('input[type="password"]', ADMIN_PASSWORD)
            await page.click('button[type="submit"]')
            
            # Wait for network requests to settle after logging in
            await page.wait_for_load_state('networkidle')
            print("Successfully authenticated.")
            
            # Step 2: Navigate to game preview page
            # Assuming the route looks like /admin/proposals/:id or similar
            preview_url = f"{BASE_URL}/admin/proposals/{proposal_id}"
            print(f"Navigating to game preview: {preview_url}")
            await page.goto(preview_url)
            
            # Wait for the page, images, and canvases to fully load
            await page.wait_for_load_state('networkidle')
            
            # Wait an extra 2 seconds just in case of any late React mount animations
            await page.wait_for_timeout(2000) 
            
            # Step 3: Capture full page screenshot
            await page.screenshot(path=output_path, full_page=True)
            print(f"Screenshot successfully saved to {output_path}")
            
            return output_path
            
        except Exception as e:
            print(f"Error during browser automation: {e}")
            raise e
        finally:
            await browser.close()

if __name__ == "__main__":
    # Harriet's Testing Task: Test screenshot output quality on 2-3 sample games
    # We will use dummy IDs for now until we identify real ones from the database
    test_ids = ["test_game_1"]
    
    for pid in test_ids:
        try:
            # We run the async function
            asyncio.run(capture_game_preview(pid, f"screenshot_{pid}.png"))
        except Exception as err:
            print(f"Failed capture for {pid}: {err}")
