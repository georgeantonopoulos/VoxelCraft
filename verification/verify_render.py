from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda msg: print(f"PageError: {msg}"))

        try:
            print("Navigating...")
            page.goto("http://localhost:3000")
            print("Waiting for canvas...")
            page.wait_for_selector("canvas", timeout=30000)
            print("Waiting for render...")
            time.sleep(5)
            print("Taking screenshot...")
            page.screenshot(path="verification/verification.png")
            print("Done.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
