from playwright.sync_api import sync_playwright
import time
import os

def verify_lumina():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a reasonable viewport
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        print("Navigating to http://localhost:3000/")
        page.goto("http://localhost:3000/")

        try:
            print("Waiting for terrain to load (Enter button)...")
            # Wait up to 2 minutes for initial generation
            page.wait_for_selector("text=Enter The Grove", timeout=120000)

            print("Terrain loaded. Entering world...")
            # Click and do NOT wait for navigation (since it's a client-side state change)
            # force=True bypasses actionability checks (like animation stability)
            page.click("text=Enter The Grove", force=True)

            print("Waiting for UI (Game Start)...")
            # Wait for the UI HUD to appear
            page.wait_for_selector("text=Organic Voxel Engine", timeout=30000)

            print("Game started. Waiting for flora to settle...")
            time.sleep(5)

            # Take screenshot
            output_path = "verification/flora_caves.png"
            page.screenshot(path=output_path)
            print(f"Screenshot saved to {output_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/lumina_error.png")
            exit(1)

        browser.close()

if __name__ == "__main__":
    verify_lumina()
