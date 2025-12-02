from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant permissions for clipboard/camera if needed (not here)
        context = browser.new_context()
        page = context.new_page()

        # Capture console logs
        console_logs = []
        page.on("console", lambda msg: console_logs.append(msg.text))

        try:
            print("Navigating to http://localhost:3000...")
            page.goto("http://localhost:3000", timeout=60000)

            # Wait for Startup Screen
            print("Waiting for 'Enter The Grove' button...")
            enter_button = page.get_by_role("button", name="Enter The Grove")
            expect(enter_button).to_be_visible(timeout=60000)

            # Click Enter
            print("Clicking Enter...")
            # Use force=True as per memory, and no_wait_after=True to avoid timeout on transition
            enter_button.click(force=True, no_wait_after=True)

            # Wait for game to load.
            # We can look for the crosshair or some HUD element.
            # Or just wait a bit and take a screenshot.
            # If Player.tsx crashes, the game loop might stop or white screen.
            # If Shader crashes, we might see black meshes.

            print("Waiting for game world to load...")
            # Wait for canvas to be active/rendering.
            # A simple wait might be enough if we don't know the exact HUD selector.
            # Let's wait 15 seconds.
            time.sleep(15)

            # Check for crash errors in console
            crashes = [log for log in console_logs if "ReferenceError" in log or "Shader Compilation Failure" in log or "ERROR" in log]
            if crashes:
                print("CRITICAL ERRORS FOUND IN CONSOLE:")
                for c in crashes:
                    print(c)
            else:
                print("No obvious crash errors in console.")

            # Screenshot
            print("Taking screenshot...")
            page.screenshot(path="verification/verification.png")
            print("Screenshot saved to verification/verification.png")

        except Exception as e:
            print(f"Test failed: {e}")
            # print console logs
            print("Console logs:")
            for log in console_logs:
                print(log)
        finally:
            browser.close()

if __name__ == "__main__":
    run()
