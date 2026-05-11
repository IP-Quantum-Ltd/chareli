import sys

from playwright.async_api import Browser, BrowserContext, async_playwright

from app.config import BrowserConfig

# Required on Linux/WSL where kernel sandbox features are unavailable
_LINUX_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"] if sys.platform.startswith("linux") else []


class BrowserSessionFactory:
    def __init__(self, config: BrowserConfig):
        self._config = config

    async def launch(self):
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=True, args=_LINUX_ARGS)
        return playwright, browser

    async def new_internal_context(self, browser: Browser) -> BrowserContext:
        return await browser.new_context(
            viewport={"width": self._config.viewport_width, "height": self._config.viewport_height}
        )

    async def new_external_context(self, browser: Browser) -> BrowserContext:
        return await browser.new_context(
            viewport={"width": self._config.viewport_width, "height": self._config.viewport_height},
            user_agent=self._config.external_user_agent,
        )
