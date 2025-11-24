from playwright.sync_api import sync_playwright
import time
import os

def verify_visuals():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        print("Navigating to http://localhost:3000/")
        # Ensure we don't have existing query params messing things up, but user said verify, so standard URL.
        page.goto("http://localhost:3000/")

        try:
            # Wait for the "Enter The Grove" button to appear (indicates loaded=true)
            # The StartupScreen shows "Growing World..." until loaded.
            print("Waiting for terrain to load (Enter button)...")
            # Increase timeout to 120s just to be safe (user mentioned 1 minute)
            page.wait_for_selector("text=Enter The Grove", timeout=120000)

            print("Terrain loaded. Entering world...")
            page.click("text=Enter The Grove")

            # Wait for transition
            time.sleep(5)

            # Take screenshot
            output_path = "render_fixed.png"
            page.screenshot(path=output_path)
            print(f"Screenshot saved to {output_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error.png")
            exit(1)

        browser.close()

if __name__ == "__main__":
    verify_visuals()
