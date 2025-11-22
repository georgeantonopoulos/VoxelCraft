
import time
from playwright.sync_api import sync_playwright

def verify_terrain_debug():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Connecting to http://localhost:3000")
        try:
            page.goto("http://localhost:3000", timeout=30000)
        except Exception as e:
            print(f"Connection failed: {e}")
            return

        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        try:
            page.wait_for_selector("canvas", timeout=15000)
            print("Canvas found. Waiting for chunks...")
            time.sleep(8)

            page.screenshot(path="verification_final.png")
            print("Screenshot taken: verification_final.png")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification_error.png")

        browser.close()

if __name__ == "__main__":
    verify_terrain_debug()
