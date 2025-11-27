from playwright.sync_api import sync_playwright, expect
import time

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for all console events and print them
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        page.goto("http://localhost:3001")

        # Wait for the terrain to load by checking for the button to be enabled
        enter_button = page.locator('button:has-text("Enter The Grove")')
        expect(enter_button).to_be_enabled(timeout=90000)

        # Directly invoke the exposed onEnter function to bypass UI interaction issues
        page.evaluate('window.triggerEnter()')

        # Wait for the game to load by looking for the in-game UI
        expect(page.locator('span:has-text("DIG")')).to_be_visible(timeout=30000)

        # Press 'e' to place the flora
        page.keyboard.press('e')

        # Wait for 5 seconds for the tree to grow
        time.sleep(5)

        # Take a screenshot
        page.screenshot(path="verification/fractal_tree_final.png")

        browser.close()

if __name__ == "__main__":
    run_verification()
