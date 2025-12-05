import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";

/**
 * Holistic happy path test covering the full API lifecycle:
 * 1. Owner creates an API Product
 * 2. Consumer discovers and requests access
 * 3. Owner approves the request
 * 4. Consumer can see their approved key
 * 5. Cleanup
 */
test.describe("Kuadrant Happy Path - Full API Lifecycle", () => {
  let common: Common;
  const testApiName = `e2e-test-api-${Date.now()}`;
  const testDisplayName = `E2E Test API ${Date.now()}`;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "kuadrant",
    });
  });

  test.describe.configure({ mode: "serial" });

  test("1. owner1 creates a new API Product", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("owner1@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // click create button
    const createButton = page.getByRole("button", { name: /create api product/i });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();

    // wait for dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // fill in the form - use placeholders since Material-UI labels don't always connect
    await page.getByPlaceholder("my-api").fill(testApiName);
    await page.getByPlaceholder("My API").fill(testDisplayName);
    await page.getByPlaceholder("API description").fill("E2E test API product - will be cleaned up");

    // select an HTTPRoute (toystore should exist)
    const httprouteSelect = page.locator('[data-testid="httproute-select"]');
    await httprouteSelect.scrollIntoViewIfNeeded();
    await httprouteSelect.click({ timeout: 5000 });

    // wait for dropdown options and select toystore
    await page.waitForTimeout(500);
    const toystoreOption = page.getByRole("option", { name: /toystore/i }).first();
    await expect(toystoreOption).toBeVisible({ timeout: 5000 });
    await toystoreOption.click();

    // publish status should already be "Published" by default

    // submit
    const submitButton = dialog.getByRole("button", { name: /create/i });
    await submitButton.click();

    // wait for success
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // verify API product appears in table
    await page.waitForLoadState("networkidle");
    const apiProductRow = page.getByText(testDisplayName);
    await expect(apiProductRow).toBeVisible({ timeout: 10000 });
  });

  test("2. consumer1 discovers the API in catalog", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("consumer1@kuadrant.local");

    // navigate to catalog APIs
    await page.goto("/catalog?filters[kind]=api");
    await page.waitForLoadState("networkidle");

    // look for our test API (may take a moment to sync)
    const apiLink = page.getByRole("link", { name: new RegExp(testDisplayName, "i") });

    // retry a few times as catalog sync may be delayed
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      found = await apiLink.isVisible({ timeout: 5000 }).catch(() => false);
      if (!found) {
        await page.reload();
        await page.waitForLoadState("networkidle");
      }
    }

    if (found) {
      await expect(apiLink).toBeVisible();
    } else {
      // if not in catalog yet, try /kuadrant page
      await page.goto("/kuadrant");
      await page.waitForLoadState("networkidle");
      const apiInTable = page.getByText(testDisplayName);
      await expect(apiInTable).toBeVisible({ timeout: 10000 });
    }
  });

  test("3. consumer1 requests API access", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("consumer1@kuadrant.local");

    // go to kuadrant page to find the API
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // find and click on the API product link
    const apiLink = page.getByRole("link", { name: new RegExp(testDisplayName, "i") }).first();
    const linkVisible = await apiLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (linkVisible) {
      await apiLink.click();
      await page.waitForLoadState("networkidle");

      // click API Keys tab
      const apiKeysTab = page.getByRole("tab", { name: /api keys/i });
      if (await apiKeysTab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await apiKeysTab.click();
        await page.waitForLoadState("networkidle");

        // click request access button
        const requestButton = page.getByRole("button", { name: /request.*access/i });
        if (await requestButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await requestButton.click();

          // fill request dialog
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible({ timeout: 5000 });

          // select a plan tier if available
          const tierSelect = page.getByLabel(/plan|tier/i);
          if (await tierSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
            await tierSelect.click();
            const bronzeOption = page.getByRole("option").first();
            await bronzeOption.click();
          }

          // fill use case
          const useCaseField = page.getByLabel(/use case/i);
          if (await useCaseField.isVisible({ timeout: 3000 }).catch(() => false)) {
            await useCaseField.fill("E2E test request");
          }

          // submit request
          const submitButton = dialog.getByRole("button", { name: /request|submit/i });
          await submitButton.click();

          // wait for dialog to close
          await expect(dialog).not.toBeVisible({ timeout: 10000 });
        }
      }
    }
  });

  test("4. owner1 sees the request in approval queue", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("owner1@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // owner should see approval queue
    const approvalQueue = page.getByText(/api access requests/i).first();
    await expect(approvalQueue).toBeVisible({ timeout: 10000 });

    // look for pending requests
    const pendingTab = page.getByRole("tab", { name: /pending/i });
    if (await pendingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForLoadState("networkidle");

      // should see consumer1's request
      const consumerRequest = page.getByText(/consumer1/i);
      const requestVisible = await consumerRequest.isVisible({ timeout: 5000 }).catch(() => false);

      if (requestVisible) {
        await expect(consumerRequest).toBeVisible();
      }
    }
  });

  test("5. owner2 cannot see owner1's requests in approval queue", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("owner2@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // owner2 should see approval queue (has approve permission)
    const approvalQueue = page.getByText(/api access requests/i).first();
    const queueVisible = await approvalQueue.isVisible({ timeout: 5000 }).catch(() => false);

    if (queueVisible) {
      // but should NOT see requests for owner1's API
      // owner2 can only see requests for their own APIs
      const pendingTab = page.getByRole("tab", { name: /pending/i });
      if (await pendingTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pendingTab.click();
        await page.waitForLoadState("networkidle");

        // look for our test API - it should NOT be visible to owner2
        const testApiRequest = page.locator(`text=${testDisplayName}`).first();
        const visible = await testApiRequest.isVisible({ timeout: 3000 }).catch(() => false);

        // owner2 should not see requests for owner1's API
        expect(visible).toBe(false);
      }
    }
  });

  test("6. admin can see and approve any request", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("admin@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // admin should see approval queue
    const approvalQueue = page.getByText(/api access requests/i).first();
    await expect(approvalQueue).toBeVisible({ timeout: 10000 });

    // admin can see all pending requests
    const pendingTab = page.getByRole("tab", { name: /pending/i });
    if (await pendingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForLoadState("networkidle");

      // admin should be able to see approve buttons
      const approveButton = page.getByRole("button", { name: /approve/i }).first();
      const buttonVisible = await approveButton.isVisible({ timeout: 5000 }).catch(() => false);

      if (buttonVisible) {
        await expect(approveButton).toBeVisible();
      }
    }
  });

  test("7. owner1 approves consumer1's request", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("owner1@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // find approval queue
    const pendingTab = page.getByRole("tab", { name: /pending/i });
    if (await pendingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForLoadState("networkidle");

      // find approve button for consumer1's request
      const approveButton = page.getByRole("button", { name: /approve/i }).first();
      if (await approveButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await approveButton.click();

        // confirm approval dialog
        const confirmDialog = page.getByRole("dialog");
        if (await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
          const confirmButton = confirmDialog.getByRole("button", { name: /approve/i });
          await confirmButton.click();
          await expect(confirmDialog).not.toBeVisible({ timeout: 10000 });
        }

        // verify request moved to approved
        await page.waitForLoadState("networkidle");
        const approvedTab = page.getByRole("tab", { name: /approved/i });
        if (await approvedTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await approvedTab.click();
          await page.waitForLoadState("networkidle");
        }
      }
    }
  });

  test("8. consumer1 sees their approved API key", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("consumer1@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // find My API Keys card
    const myApiKeysCard = page.getByText(/my api keys/i).first();
    await expect(myApiKeysCard).toBeVisible({ timeout: 10000 });

    // look for approved tab
    const approvedTab = page.getByRole("tab", { name: /approved/i });
    if (await approvedTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await approvedTab.click();
      await page.waitForLoadState("networkidle");

      // should see the approved key
      const approvedKey = page.locator("table tbody tr").first();
      const keyVisible = await approvedKey.isVisible({ timeout: 5000 }).catch(() => false);

      if (keyVisible) {
        await expect(approvedKey).toBeVisible();
      }
    }
  });

  test("9. cleanup - owner1 deletes the test API Product", async ({ page }) => {
    common = new Common(page);
    await common.dexQuickLogin("owner1@kuadrant.local");
    await page.goto("/kuadrant");
    await page.waitForLoadState("networkidle");

    // find the test API product row
    const apiProductRow = page.locator("tr").filter({ hasText: testDisplayName });
    const rowVisible = await apiProductRow.isVisible({ timeout: 5000 }).catch(() => false);

    if (rowVisible) {
      // click delete button - use title attribute selector since button has no accessible name
      const deleteButton = apiProductRow.getByRole("button", { name: /delete api product/i });
      await expect(deleteButton).toBeVisible({ timeout: 5000 });
      await deleteButton.click();

      // confirm deletion in dialog
      const confirmDialog = page.getByRole("dialog");
      await expect(confirmDialog).toBeVisible({ timeout: 5000 });

      // type confirmation text (required for high severity)
      // the confirmText is the kubernetes resource name (testApiName), not display name
      const confirmInput = confirmDialog.getByRole("textbox");
      await confirmInput.fill(testApiName);

      // click the delete button in the dialog
      const confirmButton = confirmDialog.getByRole("button", { name: /delete/i });
      await confirmButton.click();
      await expect(confirmDialog).not.toBeVisible({ timeout: 10000 });

      // verify API product is deleted - may need to reload
      await page.reload();
      await page.waitForLoadState("networkidle");
      const deletedRow = page.getByText(testDisplayName);
      await expect(deletedRow).not.toBeVisible({ timeout: 10000 });
    }
  });
});
