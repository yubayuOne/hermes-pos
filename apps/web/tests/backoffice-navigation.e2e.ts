import { test, expect } from 'e2e';

test('owner signs in and navigates between backoffice menus', async ({ app, screen }) => {
  await app.open('/login');

  await screen.getByLabel('Email atau username').fill('rina@kopipojok.id');
  await screen.getByLabel('Kata sandi').fill('rahasia123');
  await screen.getByRole('button', { name: 'Masuk' }).click();

  await expect(screen.getByRole('heading', { name: 'Ringkasan' })).toBeVisible();

  async function navigateAndMeasure(label: string, heading: string) {
    const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
    // Start intent-prefetch before the click, like a real pointer moving toward
    // the menu item. Keep the dwell short but long enough to trigger preload.
    await link.hover();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const startedAt = Date.now();
    await link.click();
    await expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    const elapsed = Date.now() - startedAt;
    console.info(`[navigation-perf] ${label}: ${elapsed}ms from click to visible heading`);
    expect(elapsed).toBeLessThan(2000);
  }

  await navigateAndMeasure('Outlet', 'Outlet');
  await navigateAndMeasure('Produk', 'Produk');
  await navigateAndMeasure('Kasir', 'Kasir');
});
