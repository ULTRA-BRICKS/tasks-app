import { test, expect } from '@playwright/test';
for (const mobile of [false, true]) {
  test(`saved multi-value filters and favorites survive reload (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
    browserName,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (mobile) await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('local-demo-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const headers = { Origin: new URL(page.url()).origin, 'x-tickets-csrf': '1' };
    const catalog = await (await page.request.get('/api/v1/catalog')).json();
    const suffix = browserName + '-' + (mobile ? 'mobile' : 'desktop');
    const title = 'Navigation target ' + suffix,
      viewName = 'Saved navigation ' + suffix;
    const project = await (
      await page.request.post('/api/v1/projects', {
        headers,
        data: { name: 'Navigation project ' + suffix, team_ids: [catalog.teams[0].id] },
      })
    ).json();
    const issue = await (
      await page.request.post('/api/v1/issues', {
        headers,
        data: { team_id: catalog.teams[0].id, title, project_id: project.id },
      })
    ).json();
    expect(issue.id).toBeTruthy();
    const favorite = await page.request.post('/api/v1/favorites', {
      headers,
      data: { target_type: 'issue', target_id: issue.id },
    });
    expect(favorite.status()).toBe(201);
    const view = await page.request.post('/api/v1/views', {
      headers,
      data: {
        name: viewName,
        shared: true,
        filters: { project_ids: [project.id], status_ids: [issue.status_id] },
      },
    });
    expect(view.status()).toBe(201);
    await page.reload();
    const openNavigation = async () => {
      if (mobile) await page.getByRole('button', { name: 'More navigation', exact: true }).click();
    };
    await openNavigation();
    await expect(
      page.locator('aside').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('navigation-' + suffix + '.png'),
      fullPage: true,
    });
    await page.locator('aside').getByRole('button', { name: viewName, exact: true }).click();
    await expect(page).toHaveURL(/project_ids=/);
    await expect(page.getByTestId('issue-row')).toHaveCount(1);
    await expect(page.getByTestId('issue-row').first()).toContainText(title);
    await page.reload();
    await expect(page.getByTestId('issue-row')).toHaveCount(1);
    await openNavigation();
    await page.locator('aside').getByRole('button', { name: title, exact: true }).click();
    await expect(page).toHaveURL('/issues/' + issue.id);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      mobile ? 393 : 1280,
    );
    expect(errors).toEqual([]);
  });
}
