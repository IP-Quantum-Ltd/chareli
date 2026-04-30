import asyncio
import json
import sys

from playwright.async_api import async_playwright


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://staging.arcadesbox.com/gameplay/74098748-0e72-4bbb-b93f-d4a92ad3c249"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(12000)
        data = await page.evaluate(
            """
            () => ({
              title: document.title,
              location: window.location.href,
              images: Array.from(document.images).map(img => ({
                src: img.currentSrc || img.src || '',
                alt: img.alt || '',
                width: img.naturalWidth || 0,
                height: img.naturalHeight || 0,
                className: img.className || '',
              })).slice(0, 30),
              iframes: Array.from(document.querySelectorAll('iframe')).map(frame => ({
                src: frame.src || '',
                width: frame.clientWidth,
                height: frame.clientHeight,
                className: frame.className || '',
              })).slice(0, 20),
              scriptsWithData: Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').filter(Boolean).slice(0, 10),
            })
            """
        )
        print(json.dumps(data, indent=2))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
