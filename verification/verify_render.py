from playwright.sync_api import sync_playwright
import time

def verify_render():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a larger viewport to see more
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        print("Navigating to http://localhost:3000/")
        page.goto("http://localhost:3000/")

        # Wait for canvas to be present
        try:
            page.wait_for_selector("canvas", timeout=30000)
            print("Canvas found. Waiting for terrain generation...")
            # Wait for some time for the workers to generate mesh and it to appear
            time.sleep(20)

            # Take screenshot
            output_path = "/home/jules/verification/render_fixed.png"
            page.screenshot(path=output_path)
            print(f"Screenshot saved to {output_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")

        browser.close()

if __name__ == "__main__":
    verify_render()
