import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

from playwright.async_api import async_playwright


async def main() -> None:
    query = (
        " ".join(sys.argv[1:])
        if len(sys.argv) > 1
        else os.environ.get("SEARCH_QUERY", "Football Kicks browser game play online")
    )
    engine = os.environ.get("SEARCH_ENGINE", "duckduckgo").lower()
    if engine == "bing":
        search_url = f"https://www.bing.com/search?q={quote_plus(query)}"
    else:
        search_url = f"https://duckduckgo.com/?q={quote_plus(query)}&ia=web"
    out_dir = Path("tmp_debug_search")
    out_dir.mkdir(exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(8000)

        html = await page.content()
        (out_dir / "duckduckgo.html").write_text(html, encoding="utf-8")
        await page.screenshot(path=str(out_dir / "duckduckgo.png"), full_page=True)

        data = await page.evaluate(
            """
            () => ({
              title: document.title,
              url: window.location.href,
              bodyText: (document.body?.innerText || '').slice(0, 4000),
              anchors: Array.from(document.querySelectorAll('a')).map(a => ({
                text: (a.textContent || '').trim(),
                href: a.href || '',
                className: a.className || ''
              })).filter(a => a.href).slice(0, 80)
            })
            """
        )
        print(json.dumps(data, indent=2))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
